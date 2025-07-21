import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

// ===================================================================
// INÍCIO DA CORREÇÃO: Mapeamento de dados mais seguro
// ===================================================================
const mapBidData = (contratacao: any) => ({
  id_unico: contratacao.id,
  titulo: contratacao.objeto || 'Objeto não informado',

  // Verifica se 'orgaoEntidade' existe antes de acessar 'razaoSocial'
  orgao: contratacao.orgaoEntidade ? contratacao.orgaoEntidade.razaoSocial : 'Órgão não informado',
  
  // Verifica se 'modalidade' existe antes de acessar 'nome'
  modalidade: contratacao.modalidade ? contratacao.modalidade.nome : 'Modalidade não informada',
  
  data_publicacao: contratacao.dataPublicacaoPncp,
  link_oficial: `https://www.gov.br/pncp/pt-br/contrato/-/contratos/${contratacao.numeroControlePncp}`,
  
  // Verifica se 'situacao' existe antes de acessar 'nome'
  status: contratacao.situacao ? contratacao.situacao.nome : 'Situação não informada',

  // Verifica se 'unidadeOrgao' existe antes de acessar os detalhes
  municipio: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.municipioNome : 'Município não informado',
  municipio_codigo_ibge: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.codigoIbge : null,
  uf: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.ufSigla : 'UF não informada',
  
  fonte: 'PNCP (Consulta)',
});
// ===================================================================
// FIM DA CORREÇÃO
// ===================================================================

function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

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
    
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 60);
    
    params.append('dataInicial', formatDateToYYYYMMDD(pastDate));
    params.append('dataFinal', formatDateToYYYYMMDD(today));

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
