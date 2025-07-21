import type { VercelRequest, VercelResponse } from '@vercel/node';
// Garanta que o caminho para seu arquivo extractFilters esteja correto
import { extractFilters } from '../../src/lib/extractFilters'; 

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';
const ALL_MODALITY_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '12', '13'];
const MAX_PAGES_TO_FETCH = 10;

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
    console.log(`Buscando: Mod. ${modalityCode}, Pág. ${page}`);
    
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'Accept': 'application/json' } });
    if (!response.ok) {
        console.error(`Erro na API para Mod. ${modalityCode}, Pág. ${page}. Status: ${response.status}`);
        return null;
    }
    const responseBody = await response.text();
    if (!responseBody) return null;
    return JSON.parse(responseBody);
};


export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Unifica a obtenção dos parâmetros, seja de GET (query) ou POST (body)
    const queryParams = req.query;
    const bodyParams = (req.method === 'POST' && req.body) ? req.body : {};
    const allParams = { ...queryParams, ...bodyParams };

    let { modality, uf, city, page = '1', keyword, question } = allParams;

    // --- LÓGICA DE IA ---
    if (question && typeof question === 'string') {
        console.log(`IA: Recebida pergunta: "${question}"`);
        const extracted = await extractFilters(question);
        
        keyword = extracted.palavrasChave.join(' ');
        
        // Mapeia o nome da modalidade extraída para o código correspondente
        const modalityMap: { [key: string]: string } = { "dispensa de licitação": "8", "pregão": "6", "pregão eletrônico": "6", "concorrência": "4" };
        const extractedModalityName = extracted.modalidade ? extracted.modalidade.toLowerCase() : '';
        modality = modalityMap[extractedModalityName] || 'all';

        uf = extracted.estado || 'all';
        city = 'all'; // A IA ainda não extrai a cidade, então mantemos 'all' para buscar no estado
        
        console.log("IA: Filtros traduzidos:", { keyword, modality, uf, city });
    }

    let modalityCodes: string[];
    if (!modality || modality === 'all' || modality === '') {
      modalityCodes = ALL_MODALITY_CODES;
    } else {
      modalityCodes = String(modality).split(',');
    }

    const baseParams = new URLSearchParams();
    const futureDate = new Date();
    futureDate.setDate(new Date().getDate() + 60);
    baseParams.append('dataFinal', formatDateToYYYYMMDD(futureDate));

    if (city && city !== 'all') {
      baseParams.append('codigoMunicipioIbge', String(city));
    } else if (uf && uf !== 'all') {
      baseParams.append('uf', String(uf));
    }

    const initialPromises = modalityCodes.map(code => fetchPageForModality(code, 1, baseParams));
    const initialResults = await Promise.allSettled(initialPromises);

    let allBids: any[] = [];
    let totalAggregatedResults = 0;
    const subsequentPagePromises = [];

    for (const [index, result] of initialResults.entries()) {
      if (result.status === 'fulfilled' && result.value) {
        const data = result.value;
        allBids.push(...(data.data || []));
        totalAggregatedResults += data.totalRegistros || 0;
        
        const totalPages = data.totalPaginas || 0;
        const modalityCode = modalityCodes[index];

        if (totalPages > 1 && modalityCode) {
          const pagesToFetch = Math.min(totalPages, MAX_PAGES_TO_FETCH);
          for (let i = 2; i <= pagesToFetch; i++) {
            subsequentPagePromises.push(fetchPageForModality(modalityCode, i, baseParams));
          }
        }
      }
    }

    if (subsequentPagePromises.length > 0) {
        console.log(`Buscando ${subsequentPagePromises.length} páginas adicionais...`);
        const subsequentResults = await Promise.allSettled(subsequentPagePromises);
        for (const result of subsequentResults) {
            if (result.status === 'fulfilled' && result.value) {
                allBids.push(...(result.value.data || []));
            }
        }
    }
    
    console.log(`Total de ${allBids.length} licitações recebidas da API antes do filtro de palavra-chave.`);

    let filteredBids = allBids;
    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
        const lowercasedKeyword = keyword.trim().toLowerCase();
        filteredBids = allBids.filter(bid =>
            (bid.objetoCompra && bid.objetoCompra.toLowerCase().includes(lowercasedKeyword)) ||
            (bid.orgaoEntidade?.razaoSocial && bid.orgaoEntidade.razaoSocial.toLowerCase().includes(lowercasedKeyword))
        );
    }
    
    console.log(`Total de ${filteredBids.length} licitações após aplicar o filtro "${keyword}".`);
    
    filteredBids.sort((a, b) => new Date(b.dataPublicacaoPncp).getTime() - new Date(a.dataPublicacaoPncp).getTime());

    const finalPage = parseInt(page as string, 10);
    const itemsPerPage = 10;
    const paginatedItems = filteredBids.slice((finalPage - 1) * itemsPerPage, finalPage * itemsPerPage);
    
    const mappedData = paginatedItems.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: totalAggregatedResults,
      totalPages: Math.ceil(filteredBids.length / itemsPerPage) || 1,
    });

  } catch (error: any) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return res.status(504).json({ error: 'A busca demorou demais para responder (Timeout).' });
    }
    if (error instanceof SyntaxError) {
        return res.status(502).json({ error: 'A API do governo retornou uma resposta inválida.' });
    }
    console.error("Erro interno na função Vercel:", error);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
