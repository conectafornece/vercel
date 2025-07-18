import type { VercelRequest, VercelResponse } from '@vercel/node';

// Endpoint para Contratações da Lei 14.133, conforme manual (seção 10.5)
const API_BASE_URL = "https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133";

// Mapeia os dados da API para o formato esperado pelo frontend
const mapBidData = (contratacao: any) => ({
  id_unico: contratacao.idCompra,
  titulo: contratacao.objetoCompra,
  orgao: contratacao.orgaoEntidadeRazaoSocial,
  modalidade: contratacao.modalidadeNome,
  data_publicacao: contratacao.dataPublicacaoPncp,
  link_oficial: `https://www.gov.br/pncp/pt-br/contrato/-/contratos/${contratacao.numeroControlePNCP}`,
  status: contratacao.situacaoCompraNomePncp,
  municipio: contratacao.unidadeOrgaoMunicipioNome,
  municipio_codigo_ibge: contratacao.unidadeOrgaoCodigolbge, // Adicionado para permitir filtro no frontend se necessário
  uf: contratacao.unidadeOrgaoUfSigla,
  fonte: 'Compras.gov.br (PNCP)',
});

// Função para formatar data para YYYY-MM-DD
function getYYYYMMDD(date: Date): string {
  return date.toISOString().split('T')[0];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Configurações de CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { modality, uf, city, page = '1', keyword } = req.query;

    if (!modality || modality === 'all') {
      return res.status(400).json({ error: 'A seleção de uma modalidade de contratação é obrigatória para esta consulta.' });
    }

    const params = new URLSearchParams();
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 30);

    params.append('dataPublicacaoPncpInicial', getYYYYMMDD(pastDate));
    params.append('dataPublicacaoPncpFinal', getYYYYMMDD(today));
    params.append('codigoModalidade', modality as string);
    
    if (page) params.append('pagina', page as string);
    
    // --- INÍCIO DA LÓGICA CORRIGIDA ---
    // Priorizamos o filtro de cidade. Se ele existir, não enviamos o de estado,
    // pois descobrimos que a API do governo tem um bug que causa conflito.
    if (city && city !== 'all') {
        params.append('unidadeOrgaoCodigoIbge', city as string);
    } else if (uf && uf !== 'all') {
        params.append('unidadeOrgaoUfSigla', uf as string);
    }
    // --- FIM DA LÓGICA CORRIGIDA ---
    
    const url = `${API_BASE_URL}?${params.toString()}`;
    console.log(`Buscando na API PNCP com a URL: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    // --- INÍCIO DO TRATAMENTO DE ERRO AVANÇADO ---
    // Verifica se a resposta não foi bem-sucedida (status não é 2xx)
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API Compras.gov.br (HTTP Status não OK): ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `A API de Contratações retornou um erro. Detalhes: ${errorText}` });
    }

    let rawData;
    try {
        // Tentamos analisar a resposta como JSON
        rawData = await response.json();
    } catch (e) {
        // Se falhar, é porque a API retornou algo que não é JSON (provavelmente uma página de erro HTML)
        console.error("Falha ao analisar a resposta da API como JSON. A API pode estar offline ou retornando uma página de erro em HTML.", e);
        // Retorna um erro 502 (Bad Gateway), que é apropriado quando um servidor intermediário recebe uma resposta inválida.
        return res.status(502).json({ error: 'A API do governo retornou uma resposta inválida (não-JSON). O serviço pode estar temporariamente indisponível.' });
    }
    // --- FIM DO TRATAMENTO DE ERRO AVANÇADO ---

    const resultsData = rawData.resultado || [];
    
    const total = rawData.totalRegistros || resultsData.length;
    const totalPages = rawData.totalPaginas || Math.ceil(total / 10);

    const mappedData = resultsData.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: total,
      totalPages: totalPages > 0 ? totalPages : 1,
    });

  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error("Timeout na API Compras.gov.br (Contratações)");
      return res.status(504).json({ error: 'Timeout na requisição à API. Tente novamente ou ajuste os filtros.' });
    }
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
