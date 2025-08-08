import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';
const ALL_MODALITY_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '12', '13'];
const MAX_PAGES_TO_FETCH = 50; // Reduzido para evitar timeouts
const DELAY_BETWEEN_REQUESTS = 100; // 100ms entre requisições
const MAX_RETRIES = 3;

const mapBidData = (contratacao: any) => ({
  id_unico: contratacao.id,
  titulo: contratacao.objetoCompra || 'Objeto não informado',
  orgao: contratacao.orgaoEntidade ? contratacao.orgaoEntidade.razaoSocial : 'Órgão não informado',
  modalidade: contratacao.modalidadeNome || (contratacao.modalidade ? contratacao.modalidade.nome : 'Modalidade não informada'),
  data_publicacao: contratacao.dataPublicacaoPncp,
  link_oficial: contratacao.linkSistemaOrigem || `https://pncp.gov.br/app/editais/${contratacao.orgaoEntidade?.cnpj}/${contratacao.anoCompra}/${contratacao.sequencialCompra}`,
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

// Função para adicionar delay entre requisições
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Função auxiliar com retry logic
const fetchWithRetry = async (url: string, retries = MAX_RETRIES): Promise<any> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Tentativa ${attempt} para: ${url}`);
      
      const response = await fetch(url, { 
        signal: AbortSignal.timeout(8000), // Reduzido para 8s
        headers: { 
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; PNCP-Client/1.0)'
        } 
      });
      
      if (response.ok) {
        const responseBody = await response.text();
        if (responseBody) {
          return JSON.parse(responseBody);
        }
      } else if (response.status === 429) {
        // Rate limit - esperar mais tempo
        const waitTime = Math.pow(2, attempt) * 1000; // Backoff exponencial
        console.log(`Rate limit detectado. Aguardando ${waitTime}ms antes da próxima tentativa...`);
        await delay(waitTime);
        continue;
      }
      
      console.error(`Erro ${response.status} na tentativa ${attempt}`);
      
    } catch (error: any) {
      console.error(`Erro na tentativa ${attempt}:`, error.message);
      
      if (attempt === retries) {
        throw error;
      }
      
      // Aguardar antes da próxima tentativa
      await delay(1000 * attempt);
    }
  }
  
  return null;
};

// Função auxiliar para buscar uma única página de uma modalidade
const fetchPageForModality = async (modalityCode: string, page: number, baseParams: URLSearchParams) => {
  const params = new URLSearchParams(baseParams);
  params.set('pagina', String(page));
  params.append('codigoModalidadeContratacao', modalityCode);
  
  const url = `${PNCP_API_BASE_URL}?${params.toString()}`;
  
  // Aguardar antes da requisição para evitar rate limit
  await delay(DELAY_BETWEEN_REQUESTS);
  
  return await fetchWithRetry(url);
};

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
      // Para buscas em estados inteiros, limitar modalidades para evitar timeout
      if (uf && uf !== 'all' && (!city || city === 'all')) {
        modalityCodes = ['1', '2', '3', '4', '5']; // Reduzir modalidades para estados
        console.log('Busca em estado detectada - limitando modalidades para evitar timeout');
      } else {
        modalityCodes = ALL_MODALITY_CODES;
      }
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

    console.log(`Iniciando busca com ${modalityCodes.length} modalidades`);

    // Buscar primeira página de cada modalidade com controle sequencial
    let allBids: any[] = [];
    let totalAggregatedResults = 0;
    const subsequentPagePromises = [];

    // Processar modalidades sequencialmente para evitar rate limit
    for (const modalityCode of modalityCodes) {
      try {
        console.log(`Processando modalidade ${modalityCode}...`);
        
        const data = await fetchPageForModality(modalityCode, 1, baseParams);
        
        if (data) {
          const bidsFromResult = data.data || [];
          allBids.push(...bidsFromResult);
          totalAggregatedResults += data.totalRegistros || 0;
          
          const totalPages = data.totalPaginas || 0;
          console.log(`Modalidade ${modalityCode}: ${bidsFromResult.length} resultados, ${totalPages} páginas`);

          // Limitar páginas adicionais para evitar timeout
          if (totalPages > 1) {
            const maxPages = uf && uf !== 'all' && (!city || city === 'all') ? 3 : MAX_PAGES_TO_FETCH;
            const pagesToFetch = Math.min(totalPages, maxPages);
            
            for (let i = 2; i <= pagesToFetch; i++) {
              subsequentPagePromises.push({modalityCode, page: i});
            }
          }
        }
      } catch (error) {
        console.error(`Erro ao processar modalidade ${modalityCode}:`, error);
        // Continuar com outras modalidades mesmo se uma falhar
      }
    }

    // Processar páginas subsequentes em lotes pequenos
    if (subsequentPagePromises.length > 0) {
      console.log(`Processando ${subsequentPagePromises.length} páginas adicionais em lotes...`);
      
      const batchSize = 3; // Processar 3 páginas por vez
      for (let i = 0; i < subsequentPagePromises.length; i += batchSize) {
        const batch = subsequentPagePromises.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async ({modalityCode, page}) => {
          try {
            return await fetchPageForModality(modalityCode, page, baseParams);
          } catch (error) {
            console.error(`Erro na página ${page} da modalidade ${modalityCode}:`, error);
            return null;
          }
        });
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value) {
            allBids.push(...(result.value.data || []));
          }
        }
        
        // Aguardar entre lotes
        if (i + batchSize < subsequentPagePromises.length) {
          await delay(200);
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
      warning: uf && uf !== 'all' && (!city || city === 'all') ? 
        'Busca em estado limitada a algumas modalidades para evitar timeout' : null
    });

  } catch (error: any) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error("Timeout na API Compras.gov.br ou na função Vercel");
      return res.status(504).json({ 
        error: 'A busca demorou demais para responder. Tente buscar em uma cidade específica ou use filtros mais restritivos.',
        suggestion: 'Para buscas em estados inteiros, considere filtrar por modalidade específica.'
      });
    }
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ 
      error: error.message || 'Erro interno no servidor',
      suggestion: 'Se o erro persistir, tente buscar em uma cidade específica.'
    });
  }
}
