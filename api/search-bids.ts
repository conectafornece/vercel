import type { VercelRequest, VercelResponse } from '@vercel/node';

// Usando o endpoint de propostas ativas, que funciona com o filtro de cidade.
const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';

const ALL_MODALITY_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '12', '13'];

const mapBidData = (contratacao: any) => ({
  id_unico: contratacao.id,
  titulo: contratacao.objetoCompra || 'Objeto não informado',
  orgao: contratacao.orgaoEntidade ? contratacao.orgaoEntidade.razaoSocial : 'Órgão não informado',
  modalidade: contratacao.modalidadeNome || (contratacao.modalidade ? contratacao.modalidade.nome : 'Modalidade não informada'),
  data_publicacao: contratacao.dataPublicacaoPncp,
  link_oficial: `https://www.gov.br/pncp/pt-br/contrato/-/contratos/${contratacao.numeroControlePNCP}`,
  status: contratacao.situacaoCompraNome || (contratacao.situacao ? contratacao.situacao.nome : 'Situação não informada'),
  municipio: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.municipioNome : 'Município não informado',
  municipio_codigo_ibge: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.codigoIbge : null,
  uf: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.ufSigla : 'UF não informada',
  fonte: 'PNCP (Consulta Ativa)',
});

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

    let modalityCodes: string[];
    if (!modality || modality === 'all' || modality === '') {
      modalityCodes = ALL_MODALITY_CODES;
    } else {
      modalityCodes = (modality as string).split(',');
    }

    // Função interna para buscar os dados de UMA ÚNICA modalidade
    const fetchBidsForModality = async (modalityCode: string) => {
      const params = new URLSearchParams();
      const futureDate = new Date();
      futureDate.setDate(new Date().getDate() + 60);
      
      params.append('dataFinal', formatDateToYYYYMMDD(futureDate));
      params.append('pagina', page as string);
      
      // Adiciona o código da modalidade para esta requisição específica
      params.append('codigoModalidadeContratacao', modalityCode);
      
      if (city && city !== 'all') {
        params.append('codigoMunicipioIbge', city as string);
      } else if (uf && uf !== 'all') {
        params.append('uf', uf as string);
      }

      const url = `${PNCP_API_BASE_URL}?${params.toString()}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'Accept': 'application/json' } });
      
      if (!response.ok) return null;
      const responseBody = await response.text();
      if (!responseBody) return null;
      return JSON.parse(responseBody);
    };

    const promises = modalityCodes.map(code => fetchBidsForModality(code));
    const results = await Promise.allSettled(promises);

    let allBids: any[] = [];
    let totalAggregatedResults = 0;
    let maxTotalPages = 0;

    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        const data = result.value;
        allBids.push(...(data.data || []));
        totalAggregatedResults += data.totalRegistros || 0;
        if ((data.totalPaginas || 0) > maxTotalPages) {
            maxTotalPages = data.totalPaginas;
        }
      }
    });
    
    // FILTRO DA PALAVRA-CHAVE FEITO AQUI, NO NOSSO SERVIDOR
    let filteredBids = allBids;
    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
        const lowercasedKeyword = keyword.trim().toLowerCase();
        filteredBids = allBids.filter(bid =>
            (bid.objetoCompra && bid.objetoCompra.toLowerCase().includes(lowercasedKeyword)) ||
            (bid.orgaoEntidade?.razaoSocial && bid.orgaoEntidade.razaoSocial.toLowerCase().includes(lowercasedKeyword))
        );
    }
    
    filteredBids.sort((a, b) => new Date(b.dataPublicacaoPncp).getTime() - new Date(a.dataPublicacaoPncp).getTime());
    const mappedData = filteredBids.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: totalAggregatedResults, // Total ANTES do filtro de palavra-chave
      totalPages: maxTotalPages > 0 ? maxTotalPages : 1,
    });

  } catch (error: any) {
    // ... (bloco catch)
  }
}
