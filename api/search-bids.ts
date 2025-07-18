import type { VercelRequest, VercelResponse } from '@vercel/node';

// Endpoint para Contratações da Lei 14.133, conforme manual (seção 10.5)
const API_BASE_URL = "https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133";

// Mapeia os dados da API para o formato esperado pelo frontend
// Baseado nos campos de retorno da seção 10.5 do manual
const mapBidData = (contratacao: any) => ({
  id_unico: contratacao.idCompra, // [cite: 1486]
  titulo: contratacao.objetoCompra, // [cite: 1491]
  orgao: contratacao.orgaoEntidadeRazaoSocial, // [cite: 1486]
  modalidade: contratacao.modalidadeNome, // [cite: 1491]
  data_publicacao: contratacao.dataPublicacaoPncp, // [cite: 1496]
  // O manual não provê um link direto, mas podemos construir um com o número de controle do PNCP
  link_oficial: `https://www.gov.br/pncp/pt-br/contrato/-/contratos/${contratacao.numeroControlePNCP}`,
  status: contratacao.situacaoCompraNomePncp, // [cite: 1496]
  municipio: contratacao.unidadeOrgaoMunicipioNome, // [cite: 1486]
  uf: contratacao.unidadeOrgaoUfSigla, // [cite: 1486]
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

    // IMPORTANTE: Validação da modalidade
    // O parâmetro 'codigoModalidade' é obrigatório segundo o manual [cite: 1479]
    if (!modality || modality === 'all') {
      return res.status(400).json({ error: 'A seleção de uma modalidade de contratação é obrigatória para esta consulta.' });
    }

    const params = new URLSearchParams();
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 30);

    // Parâmetros obrigatórios conforme manual [cite: 1479]
    params.append('dataPublicacaoPncpInicial', getYYYYMMDD(pastDate));
    params.append('dataPublicacaoPncpFinal', getYYYYMMDD(today));
    params.append('codigoModalidade', modality as string);
    
    // Parâmetros opcionais
    if (page) params.append('pagina', page as string);
    if (uf && uf !== 'all') {
        params.append('unidadeOrgaoUfSigla', uf as string); // [cite: 1479]
    }
    if (city && city !== 'all') {
        params.append('unidadeOrgaoCodigolbge', city as string); // [cite: 1479]
    }
    
    // O endpoint PNCP 14133 não possui filtro por palavra-chave direta (keyword)
    // A busca por keyword precisaria ser feita no frontend após receber os resultados.
    
    const url = `${API_BASE_URL}?${params.toString()}`;
    console.log(`Buscando na API PNCP com a URL: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API Compras.gov.br (Contratações): ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `Erro na API de Contratações. Detalhes: ${errorText}` });
    }

    const rawData = await response.json();
    const resultsData = rawData.resultado || [];
    
    const total = rawData.totalRegistros || resultsData.length;
    const totalPages = rawData.totalPaginas || Math.ceil(total / 10); // Assumindo 10/página se não informado

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
