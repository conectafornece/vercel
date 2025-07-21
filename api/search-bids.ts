import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';
const ALL_MODALITY_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '12', '13'];
const MAX_PAGES_TO_FETCH = 5; // Limite de segurança para evitar timeouts

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

// Função auxiliar para buscar uma única página de uma modalidade
const fetchPageForModality = async (modalityCode: string, page: number, baseParams: URLSearchParams) => {
    const params = new URLSearchParams(baseParams);
    params.set('pagina', String(page));
    params.append('codigoModalidadeContratacao', modalityCode);
    
    const url = `${PNCP_API_BASE_URL}?${params.toString()}`;
    // O console.log foi removido para não poluir o log com dezenas de chamadas
    // console.log(`Buscando modalidade ${modalityCode}, página ${page}`);
    
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'Accept': 'application/json' } });
    if (!response.ok) return null;
    const responseBody = await response.text();
    if (!responseBody) return null;
    return JSON.parse(responseBody);
};


export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { return res.status(200).end(); }

  try {
    const { modality, uf, city, page = '1', keyword } = req.query;

    let modalityCodes: string[];
    if (!modality || modality === 'all' || modality === '') {
      modalityCodes = ALL_MODALITY_CODES;
    } else {
      modalityCodes = (modality as string).split(',');
    }

    const baseParams = new URLSearchParams();
    const futureDate = new Date();
    futureDate.setDate(new Date().getDate() + 60);
    baseParams.append('dataFinal', formatDateToYYYYMMDD(futureDate));

    if (city && city !== 'all') {
      baseParams.append('codigoMunicipioIbge', city as string);
    } else if (uf && uf !== 'all') {
      baseParams.append('uf', uf as string);
    }

    // Etapa 1: Buscar a primeira página de cada modalidade para descobrir o total de páginas
    const initialPromises = modalityCodes.map(code => fetchPageForModality(code, 1, baseParams));
    const initialResults = await Promise.allSettled(initialPromises);

    let allBids: any[] = [];
    let totalAggregatedResults = 0;
    const subsequentPagePromises = [];

    for (const result of initialResults) {
      if (result.status === 'fulfilled' && result.value) {
        const data = result.value;
        allBids.push(...(data.data || []));
        totalAggregatedResults += data.totalRegistros || 0;
        
        const totalPages = data.totalPaginas || 0;
        const modalityCode = new URLSearchParams(result.value.config?.url).get('codigoModalidadeContratacao');

        // Se houver mais páginas, cria promessas para buscá-las, até o nosso limite
        if (totalPages > 1 && modalityCode) {
          const pagesToFetch = Math.min(totalPages, MAX_PAGES_TO_FETCH);
          for (let i = 2; i <= pagesToFetch; i++) {
            subsequentPagePromises.push(fetchPageForModality(modalityCode, i, baseParams));
          }
        }
      }
    }

    // Etapa 2: Executar as buscas das páginas adicionais em paralelo
    if (subsequentPagePromises.length > 0) {
        console.log(`Buscando ${subsequentPagePromises.length} páginas adicionais...`);
        const subsequentResults = await Promise.allSettled(subsequentPagePromises);
        for (const result of subsequentResults) {
            if (result.status === 'fulfilled' && result.value) {
                allBids.push(...(result.value.data || []));
            }
        }
    }
    
    // Etapa 3: Filtrar a lista agregada pela palavra-chave
    let filteredBids = allBids;
    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
        const lowercasedKeyword = keyword.trim().toLowerCase();
        filteredBids = allBids.filter(bid =>
            (bid.objetoCompra && bid.objetoCompra.toLowerCase().includes(lowercasedKeyword)) ||
            (bid.orgaoEntidade?.razaoSocial && bid.orgaoEntidade.razaoSocial.toLowerCase().includes(lowercasedKeyword))
        );
    }
    
    filteredBids.sort((a, b) => new Date(b.dataPublicacaoPncp).getTime() - new Date(a.dataPublicacaoPncp).getTime());

    // Paginação no lado do servidor sobre o resultado final
    const finalPage = parseInt(page as string, 10);
    const itemsPerPage = 10;
    const paginatedItems = filteredBids.slice((finalPage - 1) * itemsPerPage, finalPage * itemsPerPage);
    
    const mappedData = paginatedItems.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: totalAggregatedResults, // Total na fonte, antes do filtro de keyword
      totalPages: Math.ceil(filteredBids.length / itemsPerPage), // Total de páginas após o filtro
    });

  } catch (error: any) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error("Timeout na API Compras.gov.br ou na função Vercel");
      return res.status(504).json({ error: 'A busca demorou demais para responder (Timeout). Tente ser mais específico com os filtros.' });
    }
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}

