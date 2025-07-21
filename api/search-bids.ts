import type { VercelRequest, VercelResponse } from '@vercel/node';

// O novo e correto endpoint da API de Consulta do PNCP
const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

// Mapeia os dados da nova API para o formato que nosso frontend já espera
const mapBidData = (contratacao: any) => ({
  id_unico: contratacao.id, // O ID agora vem do campo 'id'
  titulo: contratacao.objeto,
  orgao: contratacao.orgaoEntidade.razaoSocial,
  modalidade: contratacao.modalidade.nome,
  data_publicacao: contratacao.dataPublicacaoPncp,
  // A nova API nos dá a URL direta para o item
  link_oficial: `https://www.gov.br/pncp/pt-br/contrato/-/contratos/${contratacao.numeroControlePncp}`,
  status: contratacao.situacao.nome,
  municipio: contratacao.unidadeOrgao.municipioNome,
  municipio_codigo_ibge: contratacao.unidadeOrgao.codigoIbge,
  uf: contratacao.unidadeOrgao.ufSigla,
  fonte: 'PNCP (Consulta)',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { modality, uf, city, page = '1', keyword } = req.query;

    const params = new URLSearchParams();
    
    // Parâmetros de data (últimos 30 dias)
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 30);
    params.append('dataInicial', pastDate.toISOString().split('T')[0]);
    params.append('dataFinal', today.toISOString().split('T')[0]);

    // Parâmetro de página
    params.append('pagina', page as string);
    params.append('tamanhoPagina', '10'); // Definimos um tamanho de página padrão

    // --- NOVOS PARÂMETROS DA API PNCP ---

    // Palavra-chave (termoBusca)
    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      params.append('termoBusca', keyword.trim());
    }

    // Modalidades (a API aceita múltiplos valores)
    if (modality && typeof modality === 'string' && modality !== 'all') {
      const modalityCodes = modality.split(',');
      modalityCodes.forEach(code => {
        params.append('codigoModalidadeContratacao', code);
      });
    }

    // Localização (a API usa UF e Código IBGE do Município)
    if (city && city !== 'all') {
      params.append('codigoIbgeMunicipio', city as string);
    } else if (uf && uf !== 'all') {
      params.append('uf', uf as string);
    }

    const url = `${PNCP_API_BASE_URL}?${params.toString()}`;
    console.log(`Buscando na API de Consulta do PNCP: ${url}`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000), // Timeout de 30 segundos
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API do PNCP: ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `A API do PNCP retornou um erro. Detalhes: ${errorText}` });
    }

    const rawData = await response.json();
    
    // A estrutura da resposta é diferente, os resultados estão em 'data'
    const resultsData = rawData.data || [];
    
    const mappedData = resultsData.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: rawData.total,
      totalPages: rawData.totalPaginas,
    });

  } catch (error: any) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error("Timeout na API PNCP ou na função Vercel");
      return res.status(504).json({ error: 'A busca demorou demais para responder (Timeout). Tente ser mais específico com os filtros.' });
    }
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
