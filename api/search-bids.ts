import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';
const ALL_MODALITY_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '12', '13'];
const MAX_PAGES_TO_FETCH = 50; // Reduzido para evitar timeouts
const DELAY_BETWEEN_REQUESTS = 100; // 100ms entre requisições
const MAX_RETRIES = 3;

// ===================================================================
// SISTEMA DE CACHE SIMPLES EM MEMÓRIA
// ===================================================================
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos de cache

// ===================================================================
// SISTEMA DE CACHE COM CHAVE MAIS GRANULAR
// ===================================================================
// Garantir que o cache existe e persiste entre execuções
if (!global.pncpCache) {
  global.pncpCache = new Map();
}
const cache = global.pncpCache;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos de cache

const getCacheKey = (baseParams: URLSearchParams, modalityCodes: string[], keyword?: string, page?: string) => {
  // Chave mais específica incluindo parâmetros importantes
  const sortedParams = Array.from(baseParams.entries()).sort();
  const paramsString = sortedParams.map(([k, v]) => `${k}=${v}`).join('&');
  const modalitiesString = modalityCodes.sort().join(',');
  const key = `${paramsString}_mod[${modalitiesString}]_kw[${keyword || 'none'}]_p${page || '1'}`;
  return key;
};

const getCachedResult = (key: string) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`📦 Cache HIT para chave: ${key.substring(0, 80)}...`);
    return cached.data;
  }
  
  // Remove cache expirado
  if (cached) {
    console.log(`🗑️ Removendo cache expirado: ${key.substring(0, 80)}...`);
    cache.delete(key);
  }
  
  console.log(`❌ Cache MISS para chave: ${key.substring(0, 80)}...`);
  return null;
};

const setCachedResult = (key: string, data: any) => {
  // Limita o tamanho do cache para evitar consumo excessivo de memória
  if (cache.size > 100) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  
  cache.set(key, { 
    data, 
    timestamp: Date.now(),
    size: JSON.stringify(data).length 
  });
  console.log(`💾 Resultado salvo no cache (${cache.size} entradas)`);
};

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

// Função auxiliar com retry logic MELHORADO
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
          const data = JSON.parse(responseBody);
          console.log(`✅ Sucesso: ${data?.data?.length || 0} registros retornados`);
          return data;
        } else {
          console.log(`⚠️ Resposta vazia (body vazio) na tentativa ${attempt}`);
        }
      } else if (response.status === 204) {
        // 204 No Content - considerado sucesso com resultado vazio
        console.log(`📭 Status 204 (No Content) - sem resultados para esta página`);
        return { data: [], totalRegistros: 0, totalPaginas: 0 };
      } else if (response.status === 429) {
        // Rate limit - esperar mais tempo
        const waitTime = Math.pow(2, attempt) * 1000; // Backoff exponencial
        console.log(`🚫 Rate limit detectado. Aguardando ${waitTime}ms antes da próxima tentativa...`);
        await delay(waitTime);
        continue;
      } else {
        console.error(`❌ Erro HTTP ${response.status} (${response.statusText}) na tentativa ${attempt}`);
      }
      
    } catch (error: any) {
      console.error(`💥 Erro na tentativa ${attempt}:`, error.message);
      
      if (attempt === retries) {
        console.error(`🔥 Todas as ${retries} tentativas falharam para: ${url}`);
        throw error;
      }
      
      // Aguardar antes da próxima tentativa
      await delay(1000 * attempt);
    }
  }
  
  console.log(`⚠️ Retornando null após ${retries} tentativas para: ${url}`);
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
    
    // ===================================================================
    // FILTRO DE DATA INTELIGENTE - SEM LIMITE INICIAL PARA PALAVRA-CHAVE
    // ===================================================================
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + 60);
    
    // Para buscas em estados COM palavra-chave: NÃO limitar data inicial
    if (uf && uf !== 'all' && (!city || city === 'all')) {
      if (keyword && keyword.trim() !== '') {
        console.log('🔍 Palavra-chave presente - buscando SEM limite de data inicial para máxima cobertura');
        // Não adiciona dataInicial - busca em todo o histórico
      } else {
        const startDate = new Date();
        startDate.setDate(today.getDate() - 30); // Só limita se não houver palavra-chave
        baseParams.append('dataInicial', formatDateToYYYYMMDD(startDate));
        console.log('🗓️ Busca sem palavra-chave - limitando aos últimos 30 dias para otimizar');
      }
    }
    
    baseParams.append('dataFinal', formatDateToYYYYMMDD(futureDate));

    if (city && city !== 'all') {
      baseParams.append('codigoMunicipioIbge', city as string);
    } else if (uf && uf !== 'all') {
      baseParams.append('uf', uf as string);
    }

    // ===================================================================
    // VERIFICAR CACHE COM LOGS DETALHADOS
    // ===================================================================
    const cacheKey = getCacheKey(baseParams, modalityCodes, keyword as string, page as string);
    console.log(`🔍 Verificando cache para: ${cacheKey.substring(0, 100)}...`);
    
    const cachedResult = getCachedResult(cacheKey);
    
    if (cachedResult) {
      console.log(`📦 Retornando ${cachedResult.filteredBids?.length || 0} resultados do cache`);
      // Aplicar paginação no resultado do cache
      const finalPage = parseInt(page as string, 10);
      const itemsPerPage = 10;
      const paginatedItems = cachedResult.filteredBids.slice((finalPage - 1) * itemsPerPage, finalPage * itemsPerPage);
      
      return res.status(200).json({
        data: paginatedItems.map(mapBidData),
        total: cachedResult.totalAggregatedResults,
        totalPages: Math.ceil(cachedResult.filteredBids.length / itemsPerPage) || 1,
        cached: true, // Indica que veio do cache
        warning: cachedResult.warning || null
      });
    }

    console.log(`Iniciando busca com ${modalityCodes.length} modalidades`);

    // Buscar primeira página de cada modalidade com controle sequencial
    let allBids: any[] = [];
    let totalAggregatedResults = 0;
    const subsequentPagePromises = [];

    // Processar modalidades sequencialmente para evitar rate limit
    let successfulRequests = 0;
    let failedRequests = 0;
    
    for (const modalityCode of modalityCodes) {
      try {
        console.log(`🔄 Processando modalidade ${modalityCode}...`);
        
        const data = await fetchPageForModality(modalityCode, 1, baseParams);
        
        if (data) {
          const bidsFromResult = data.data || [];
          allBids.push(...bidsFromResult);
          totalAggregatedResults += data.totalRegistros || 0;
          successfulRequests++;
          
          const totalPages = data.totalPaginas || 0;
          console.log(`✅ Modalidade ${modalityCode}: ${bidsFromResult.length} resultados página 1, ${totalPages} páginas totais`);

          // ===================================================================
          // ESTRATÉGIA MAIS AGRESSIVA PARA PALAVRA-CHAVE ESPECÍFICA
          // ===================================================================
          if (totalPages > 1) {
            let maxPages;
            
            if (uf && uf !== 'all' && (!city || city === 'all')) {
              // Para estados: buscar MUITO mais páginas se tivermos palavra-chave específica
              if (keyword && keyword.trim() !== '') {
                maxPages = Math.min(totalPages, 100); // Aumentado para 100 páginas com palavra-chave
                console.log(`🔍 Palavra-chave "${keyword}" detectada - buscando até ${maxPages} páginas na modalidade ${modalityCode}`);
              } else {
                maxPages = Math.min(totalPages, 5); // Menos páginas sem palavra-chave
              }
            } else {
              maxPages = MAX_PAGES_TO_FETCH; // Para cidades, buscar todas as páginas
            }
            
            const pagesToFetch = Math.min(totalPages, maxPages);
            
            for (let i = 2; i <= pagesToFetch; i++) {
              subsequentPagePromises.push({modalityCode, page: i});
            }
          }
        } else {
          failedRequests++;
          console.log(`❌ Falha na modalidade ${modalityCode} - dados nulos retornados`);
        }
      } catch (error) {
        failedRequests++;
        console.error(`💥 Erro ao processar modalidade ${modalityCode}:`, error);
        // Continuar com outras modalidades mesmo se uma falhar
      }
    }
    
    console.log(`📊 Resumo primeira página: ${successfulRequests} sucessos, ${failedRequests} falhas de ${modalityCodes.length} modalidades`);

    // Processar páginas subsequentes em lotes pequenos
    if (subsequentPagePromises.length > 0) {
      console.log(`📄 Processando ${subsequentPagePromises.length} páginas adicionais em lotes...`);
      
      // ===================================================================
      // BATCHING DINÂMICO COM CONTADORES DE SUCESSO/FALHA
      // ===================================================================
      const batchSize = subsequentPagePromises.length > 50 ? 5 : 3; // Lotes maiores para muitas páginas
      let batchSuccesses = 0;
      let batchFailures = 0;
      
      for (let i = 0; i < subsequentPagePromises.length; i += batchSize) {
        const batch = subsequentPagePromises.slice(i, i + batchSize);
        console.log(`🔄 Processando lote ${Math.floor(i/batchSize) + 1}/${Math.ceil(subsequentPagePromises.length/batchSize)} (páginas ${i+1}-${Math.min(i+batchSize, subsequentPagePromises.length)})`);
        
        const batchPromises = batch.map(async ({modalityCode, page}) => {
          try {
            const result = await fetchPageForModality(modalityCode, page, baseParams);
            if (result && result.data) {
              return { success: true, data: result.data, modalityCode, page };
            } else {
              return { success: false, modalityCode, page, reason: 'dados nulos' };
            }
          } catch (error) {
            return { success: false, modalityCode, page, reason: error.message };
          }
        });
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            if (result.value.success) {
              allBids.push(...result.value.data);
              batchSuccesses++;
            } else {
              batchFailures++;
              console.log(`❌ Falha na página ${result.value.page} da modalidade ${result.value.modalityCode}: ${result.value.reason}`);
            }
          } else {
            batchFailures++;
            console.log(`💥 Erro promise rejected:`, result.reason);
          }
        }
        
        // Aguardar entre lotes - menos tempo se há palavra-chave específica
        if (i + batchSize < subsequentPagePromises.length) {
          const waitTime = keyword && keyword.trim() !== '' ? 100 : 200;
          await delay(waitTime);
        }
      }
      
      console.log(`📊 Resumo páginas adicionais: ${batchSuccesses} sucessos, ${batchFailures} falhas de ${subsequentPagePromises.length} páginas`);
    }
    
    console.log(`Total de ${allBids.length} licitações recebidas da API antes do filtro de palavra-chave.`);

    let filteredBids = allBids;
    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      const lowercasedKeyword = keyword.trim().toLowerCase();
      
      // ===================================================================
      // FILTRO SUPER ABRANGENTE + DEBUG DETALHADO
      // ===================================================================
      console.log(`🔍 Procurando por "${keyword}" em ${allBids.length} licitações...`);
      
      filteredBids = allBids.filter((bid, index) => {
        const searchFields = {
          objetoCompra: bid.objetoCompra || '',
          razaoSocial: bid.orgaoEntidade?.razaoSocial || '',
          municipio: bid.unidadeOrgao?.municipioNome || '',
          modalidade: bid.modalidadeNome || '',
          situacao: bid.situacaoCompraNome || ''
        };
        
        const searchText = Object.values(searchFields).join(' ').toLowerCase();
        const hasKeyword = searchText.includes(lowercasedKeyword);
        
        // Log detalhado das primeiras 10 licitações para debug
        if (index < 10) {
          console.log(`📄 Licitação ${index + 1}:`);
          console.log(`   Objeto: ${searchFields.objetoCompra.substring(0, 100)}...`);
          console.log(`   Órgão: ${searchFields.razaoSocial}`);
          console.log(`   Município: ${searchFields.municipio}`);
          console.log(`   Modalidade: ${searchFields.modalidade}`);
          console.log(`   Contém "${keyword}": ${hasKeyword ? '✅' : '❌'}`);
        }
        
        return hasKeyword;
      });
      
      console.log(`🔍 Filtro aplicado: "${keyword}"`);
      console.log(`📊 Resultados por modalidade antes do filtro:`);
      const modalityCounts = {};
      allBids.forEach(bid => {
        const modalidade = bid.modalidadeNome || 'Não informada';
        modalityCounts[modalidade] = (modalityCounts[modalidade] || 0) + 1;
      });
      Object.entries(modalityCounts).forEach(([modalidade, count]) => {
        console.log(`   ${modalidade}: ${count} licitações`);
      });
      
      console.log(`📊 Resultados por município nas primeiras 50 licitações:`);
      const municipioCounts = {};
      allBids.slice(0, 50).forEach(bid => {
        const municipio = bid.unidadeOrgao?.municipioNome || 'Não informado';
        municipioCounts[municipio] = (municipioCounts[municipio] || 0) + 1;
      });
      Object.entries(municipioCounts).forEach(([municipio, count]) => {
        console.log(`   ${municipio}: ${count} licitações`);
      });
    }
    
    console.log(`Total de ${filteredBids.length} licitações após aplicar o filtro "${keyword}".`);
    
    filteredBids.sort((a, b) => new Date(b.dataPublicacaoPncp).getTime() - new Date(a.dataPublicacaoPncp).getTime());

    const warning = uf && uf !== 'all' && (!city || city === 'all') ? 
      'Busca em estado limitada a algumas modalidades para evitar timeout' : null;

    // ===================================================================
    // SALVAR NO CACHE COM LOGS DETALHADOS
    // ===================================================================
    const resultToCache = {
      filteredBids,
      totalAggregatedResults,
      warning
    };
    
    console.log(`💾 Salvando no cache:`);
    console.log(`   - Chave: ${cacheKey.substring(0, 100)}...`);
    console.log(`   - Total bruto: ${allBids.length} licitações`);
    console.log(`   - Total filtrado: ${filteredBids.length} licitações`);
    console.log(`   - Cache entries: ${cache.size}/100`);
    
    setCachedResult(cacheKey, resultToCache);

    const finalPage = parseInt(page as string, 10);
    const itemsPerPage = 10;
    const paginatedItems = filteredBids.slice((finalPage - 1) * itemsPerPage, finalPage * itemsPerPage);
    
    const mappedData = paginatedItems.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: totalAggregatedResults,
      totalPages: Math.ceil(filteredBids.length / itemsPerPage) || 1,
      cached: false, // Indica que é um resultado novo
      warning
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
