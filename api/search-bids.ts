import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

const mapBidData = (contratacao: any) => ({
  id_unico: contratacao.id,
  titulo: contratacao.objeto,
  orgao: contratacao.orgaoEntidade.razaoSocial,
  modalidade: contratacao.modalidade.nome,
  data_publicacao: contratacao.dataPublicacaoPncp,
  link_oficial: `https://www.gov.br/pncp/pt-br/contrato/-/contratos/${contratacao.numeroControlePncp}`,
  status: contratacao.situacao.nome,
  municipio: contratacao.unidadeOrgao.municipioNome,
  municipio_codigo_ibge: contratacao.unidadeOrgao.codigoIbge,
  uf: contratacao.unidadeOrgao.ufSigla,
  fonte: 'PNCP (Consulta)',
});

// ===================================================================
// INÍCIO DA CORREÇÃO 1: Nova função para formatar a data
// ===================================================================
/**
 * Formata um objeto Date para o formato yyyyMMdd exigido pela API do PNCP.
 * @param date O objeto Date a ser formatado.
 * @returns A data como uma string no formato 'yyyyMMdd'.
 */
function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  // getMonth() é 0-indexed (0-11), então adicionamos 1.
  // padStart garante que o mês e o dia tenham sempre 2 dígitos (ex: 07).
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}${month}${day}`;
}
// ===================================================================
// FIM DA CORREÇÃO 1
// ===================================================================

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
    
    // --- Parâmetros de data ---
    const today = new Date();
    const pastDate = new Date();
    // ===================================================================
    // INÍCIO DA CORREÇÃO 2: Período de busca estendido para 60 dias
    // ===================================================================
    pastDate.setDate(today.getDate() - 60);
    
    // Usa a nova função para formatar as datas corretamente
    params.append('dataInicial', formatDateToYYYYMMDD(pastDate));
    params.append('dataFinal', formatDateToYYYYMMDD(today));
    // ===================================================================
    // FIM DA CORREÇÃO 2
    // ===================================================================

    params.append('pagina', page as string);
    params.append('tamanhoPagina', '10');

    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      params.append('termoBusca', keyword.trim());
    }

    if (modality && typeof modality === 'string' && modality !== 'all') {
      const modalityCodes = modality.split(',');
      modalityCodes.forEach(code => {
        params.append('codigoModalidadeContratacao', code);
      });
    }

    if (city && city !== 'all') {
      params.append('codigoIbgeMunicipio', city as string);
    } else if (uf && uf !== 'all') {
      params.append('uf', uf as string);
    }

    const url = `${PNCP_API_BASE_URL}?${params.toString()}`;
    console.log(`Buscando na API de Consulta do PNCP: ${url}`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API do PNCP: ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `A API do PNCP retornou um erro. Detalhes: ${errorText}` });
    }

    const rawData = await response.json();
    
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
