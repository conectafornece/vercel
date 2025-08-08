import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';
const ALL_MODALITY_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '12', '13'];
const MAX_PAGES_TO_FETCH = 50;
const DELAY_BETWEEN_REQUESTS = 100;
const MAX_RETRIES = 3;

// ===================================================================
// CONFIGURAÇÃO SUPABASE COM FETCH NATIVO
// ===================================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabaseHeaders = {
  'apikey': SUPABASE_ANON_KEY!,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

// ===================================================================
// FUNÇÕES DE SUPABASE COM FETCH NATIVO
// ===================================================================

// Gerar chave de cache para busca
const generateCacheKey = (uf?: string, city?: string, keyword?: string, modality?: string) => {
  return `${uf || 'all'}_${city || 'all'}_${keyword || 'none'}_${modality || 'all'}`;
};

// Buscar licitações no Supabase
const searchInSupabase = async (uf?: string, city?: string, keyword?: string, page = 1) => {
  console.log('🔍 Buscando no Supabase...');
  
  try {
    let url = `${SUPABASE_URL}/rest/v1/licitacoes?select=*&order=data_publicacao.desc`;
    
    // Filtros
    if (uf && uf !== 'all') {
      url += `&uf=eq.${uf}`;
    }
    
    if (city && city !== 'all') {
      url += `&municipio_codigo_ibge=eq.${city}`;
    }
    
    if (keyword && keyword.trim() !== '') {
      url += `&or=(titulo.ilike.*${keyword}*,orgao.ilike.*${keyword}*)`;
    }

    // Paginação
    const limit = 50;
    const offset = (page - 1) * limit;
    url += `&limit=${limit}&offset=${offset}`;

    const response = await fetch(url, {
      headers: supabaseHeaders
    });

    if (!response.ok) {
      console.error('❌ Erro no Supabase:', response.status, response.statusText);
      return { data: [], count: 0 };
    }

    const data = await response.json();
    const count = parseInt(response.headers.get('Content-Range')?.split('/')[1] || '0');

    console.log(`✅ Encontradas ${data?.length || 0} licitações no Supabase`);
    return { data: data || [], count };
  } catch (error) {
    console.error('❌ Erro no Supabase:', error);
    return { data: [], count: 0 };
  }
};

// Salvar licitações no Supabase
const saveToSupabase = async (licitacoes: any[]) => {
  if (!licitacoes.length) return { saved: 0, errors: 0 };
  
  console.log(`💾 Salvando ${licitacoes.length} licitações no Supabase...`);
  
  const licitacoesFormatadas = licitacoes.map(bid => ({
    id_pncp: bid.id,
    titulo: bid.objetoCompra || 'Objeto não informado',
    orgao: bid.orgaoEntidade?.razaoSocial || 'Órgão não informado',
    modalidade: bid.modalidadeNome || 'Modalidade não informada',
    data_publicacao: bid.dataPublicacaoPncp ? new Date(bid.dataPublicacaoPncp).toISOString().split('T')[0] : null,
    link_oficial: bid.linkSistemaOrigem || `https://pncp.gov.br/app/editais/${bid.orgaoEntidade?.cnpj}/${bid.anoCompra}/${bid.sequencialCompra}`,
    status: bid.situacaoCompraNome || 'Status não informado',
    municipio: bid.unidadeOrgao?.municipioNome || 'Município não informado',
    municipio_codigo_ibge: bid.unidadeOrgao?.codigoIbge || null,
    uf: bid.unidadeOrgao?.ufSigla || 'UF não informada',
    dados_completos: bid
  }));

  let saved = 0;
  let errors = 0;

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/licitacoes`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(licitacoesFormatadas)
    });

    if (response.ok) {
      saved = licitacoesFormatadas.length;
      console.log(`✅ Salvos: ${saved} licitações`);
    } else {
      errors = licitacoesFormatadas.length;
      console.error('❌ Erro ao salvar:', response.status, response.statusText);
    }
  } catch (error) {
    errors = licitacoesFormatadas.length;
    console.error('❌ Erro ao salvar:', error);
  }

  return { saved, errors };
};

// Verificar se precisa atualizar cache
const needsRefresh = async (cacheKey: string) => {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/cache_buscas?chave_busca=eq.${cacheKey}&select=ultima_atualizacao`,
      { headers: supabaseHeaders }
    );

    if (!response.ok) return true;

    const data = await response.json();
    if (!data.length) return true;

    const agora = new Date();
    const ultimaAtualizacao = new Date(data[0].ultima_atualizacao);
    const diffHoras = (agora.getTime() - ultimaAtualizacao.getTime()) / (1000 * 60 * 60);

    return diffHoras > 6; // Atualizar a cada 6 horas
  } catch (error) {
    console.error('❌ Erro ao verificar cache:', error);
    return true; // Se der erro, atualizar
  }
};

// Atualizar cache de busca
const updateCacheRecord = async (cacheKey: string, totalEncontrado: number, parametros: any) => {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/cache_buscas`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        chave_busca: cacheKey,
        parametros,
        total_encontrado: totalEncontrado,
        ultima_atualizacao: new Date().toISOString()
      })
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar cache:', error);
  }
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
    const pageNum = parseInt(page as string, 10);

    console.log(`🚀 Iniciando busca híbrida: UF=${uf}, City=${city}, Keyword=${keyword}, Page=${page}`);

    // ===================================================================
    // ETAPA 1: BUSCAR NO SUPABASE PRIMEIRO
    // ===================================================================
    const supabaseResults = await searchInSupabase(
      uf as string, 
      city as string, 
      keyword as string, 
      pageNum
    );

    let allResults = supabaseResults.data.map(item => ({
      id_unico: item.id_pncp,
      titulo: item.titulo,
      orgao: item.orgao,
      modalidade: item.modalidade,
      data_publicacao: item.data_publicacao,
      link_oficial: item.link_oficial,
      status: item.status,
      municipio: item.municipio,
      municipio_codigo_ibge: item.municipio_codigo_ibge,
      uf: item.uf,
      fonte: 'Supabase (Cache Local)',
    }));

    // ===================================================================
    // ETAPA 2: VERIFICAR SE PRECISA BUSCAR NA API PNCP
    // ===================================================================
    const cacheKey = generateCacheKey(uf as string, city as string, keyword as string, modality as string);
    const precisaAtualizar = await needsRefresh(cacheKey);

    console.log(`📊 Supabase: ${allResults.length} resultados. Precisa atualizar: ${precisaAtualizar}`);

    if (precisaAtualizar || allResults.length < 5) {
      console.log('🔄 Buscando dados atualizados na API PNCP...');

      // ===================================================================
      // ETAPA 3: BUSCAR NA API PNCP (CÓDIGO ORIGINAL SIMPLIFICADO)
      // ===================================================================
      let modalityCodes: string[];
      if (!modality || modality === 'all' || modality === '') {
        modalityCodes = uf && uf !== 'all' && (!city || city === 'all') 
          ? ['1', '2', '3', '4', '5'] 
          : ALL_MODALITY_CODES;
      } else {
        modalityCodes = (modality as string).split(',');
      }

      const baseParams = new URLSearchParams();
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + 60);
      
      if (uf && uf !== 'all' && (!city || city === 'all') && (!keyword || keyword.trim() === '')) {
        const startDate = new Date();
        startDate.setDate(today.getDate() - 30);
        baseParams.append('dataInicial', formatDateToYYYYMMDD(startDate));
      }
      
      baseParams.append('dataFinal', formatDateToYYYYMMDD(futureDate));

      if (city && city !== 'all') {
        baseParams.append('codigoMunicipioIbge', city as string);
      } else if (uf && uf !== 'all') {
        baseParams.append('uf', uf as string);
      }

      let pncpBids: any[] = [];
      let totalFromPNCP = 0;

      // Buscar apenas primeiras páginas para não demorar muito
      const maxModalidades = modalityCodes.slice(0, 3); // Limitar a 3 modalidades para ser mais rápido
      
      for (const modalityCode of maxModalidades) {
        try {
          const data = await fetchPageForModality(modalityCode, 1, baseParams);
          if (data) {
            pncpBids.push(...(data.data || []));
            totalFromPNCP += data.totalRegistros || 0;
            
            // Buscar mais algumas páginas se tiver palavra-chave
            if (keyword && keyword.trim() !== '' && data.totalPaginas > 1) {
              const maxPages = Math.min(data.totalPaginas, 5); // Máximo 5 páginas por modalidade
              for (let i = 2; i <= maxPages; i++) {
                const pageData = await fetchPageForModality(modalityCode, i, baseParams);
                if (pageData) {
                  pncpBids.push(...(pageData.data || []));
                }
              }
            }
          }
        } catch (error) {
          console.error(`❌ Erro na modalidade ${modalityCode}:`, error);
        }
      }

      console.log(`📡 PNCP: ${pncpBids.length} resultados coletados`);

      // ===================================================================
      // ETAPA 4: SALVAR NOVOS DADOS NO SUPABASE
      // ===================================================================
      if (pncpBids.length > 0) {
        await saveToSupabase(pncpBids);
        await updateCacheRecord(cacheKey, totalFromPNCP, { uf, city, keyword, modality });
        
        // Adicionar resultados do PNCP aos do Supabase (removendo duplicatas)
        const existingIds = new Set(allResults.map(r => r.id_unico));
        const newResults = pncpBids
          .filter(bid => !existingIds.has(bid.id))
          .map(mapBidData);
        
        allResults = [...allResults, ...newResults];
        console.log(`➕ Adicionados ${newResults.length} novos resultados`);
      }
    }

    // ===================================================================
    // ETAPA 5: FILTRAR E PAGINAR RESULTADOS
    // ===================================================================
    let filteredResults = allResults;
    
    if (keyword && keyword.trim() !== '') {
      const lowercaseKeyword = keyword.toLowerCase();
      filteredResults = allResults.filter(item =>
        item.titulo.toLowerCase().includes(lowercaseKeyword) ||
        item.orgao.toLowerCase().includes(lowercaseKeyword) ||
        item.municipio.toLowerCase().includes(lowercaseKeyword)
      );
    }

    // Ordenar por data
    filteredResults.sort((a, b) => new Date(b.data_publicacao).getTime() - new Date(a.data_publicacao).getTime());

    // Paginação
    const itemsPerPage = 10;
    const totalPages = Math.ceil(filteredResults.length / itemsPerPage);
    const startIndex = (pageNum - 1) * itemsPerPage;
    const paginatedResults = filteredResults.slice(startIndex, startIndex + itemsPerPage);

    console.log(`✅ Retornando ${paginatedResults.length} de ${filteredResults.length} resultados (página ${pageNum}/${totalPages})`);

    return res.status(200).json({
      data: paginatedResults,
      total: filteredResults.length,
      totalPages,
      cached: false,
      source: 'hybrid',
      supabaseCount: supabaseResults.count,
      warning: null
    });

  } catch (error: any) {
    console.error("💥 Erro na busca híbrida:", error);
    return res.status(500).json({ 
      error: error.message || 'Erro interno no servidor',
      suggestion: 'Tente novamente em alguns momentos.'
    });
  }
}dResult(cacheKey, resultToCache);

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
