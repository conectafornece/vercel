import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';
// CÓDIGOS CORRETOS DAS MODALIDADES CONFORME MANUAL OFICIAL PNCP
const ALL_MODALITY_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
const DELAY_BETWEEN_REQUESTS = 150;
const MAX_RETRIES = 3;
const MAX_PAGE_SIZE = 500; // ← NOVO: Tamanho máximo da página conforme documentação

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
// FUNÇÕES AUXILIARES
// ===================================================================
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// ===================================================================
// FUNÇÕES SUPABASE - APENAS FILTROS BÁSICOS
// ===================================================================

// Buscar no Supabase - SEM filtro de modalidade
const searchInSupabase = async (uf?: string, city?: string, keyword?: string) => {
  console.log('🔍 Buscando no Supabase...');
  
  try {
    let url = `${SUPABASE_URL}/rest/v1/licitacoes?select=*&order=data_publicacao.desc.nullslast&limit=200`;
    
    // Apenas filtros básicos - modalidade será filtrada no frontend
    if (uf && uf !== 'all') {
      url += `&uf=eq.${uf}`;
    }
    
    if (city && city !== 'all') {
      url += `&municipio_codigo_ibge=eq.${city}`;
    }
    
    if (keyword && keyword.trim() !== '') {
      url += `&or=(titulo.ilike.*${keyword}*,orgao.ilike.*${keyword}*)`;
    }

    const response = await fetch(url, { headers: supabaseHeaders });

    if (!response.ok) {
      console.error('❌ Erro no Supabase:', response.status, response.statusText);
      return [];
    }

    const data = await response.json();
    console.log(`✅ Supabase: ${data?.length || 0} licitações encontradas`);
    return data || [];
  } catch (error) {
    console.error('❌ Erro no Supabase:', error);
    return [];
  }
};

// Salvar no Supabase
const saveToSupabase = async (licitacoes: any[]) => {
  if (!licitacoes.length) return 0;
  
  console.log(`💾 Salvando ${licitacoes.length} licitações no Supabase...`);
  
  const licitacoesFormatadas = licitacoes.map(bid => {
    // Função para converter data ISO para formato YYYY-MM-DD
    const formatDate = (dateString: string | null) => {
      if (!dateString) return null;
      try {
        return new Date(dateString).toISOString().split('T')[0];
      } catch {
        return null;
      }
    };

    // Determinar data de expiração baseada no status e datas disponíveis
    const getDataExpiracao = () => {
      // Se tem data de encerramento de proposta, usar ela + 30 dias
      if (bid.dataEncerramentoProposta) {
        const dataEncerramento = new Date(bid.dataEncerramentoProposta);
        dataEncerramento.setDate(dataEncerramento.getDate() + 30);
        return dataEncerramento.toISOString().split('T')[0];
      }
      
      // Se tem data de abertura, usar ela + 60 dias
      if (bid.dataAberturaProposta) {
        const dataAbertura = new Date(bid.dataAberturaProposta);
        dataAbertura.setDate(dataAbertura.getDate() + 60);
        return dataAbertura.toISOString().split('T')[0];
      }
      
      // Caso contrário, usar data de publicação + 90 dias
      if (bid.dataPublicacaoPncp) {
        const dataPublicacao = new Date(bid.dataPublicacaoPncp);
        dataPublicacao.setDate(dataPublicacao.getDate() + 90);
        return dataPublicacao.toISOString().split('T')[0];
      }
      
      // Fallback: hoje + 90 dias
      const hoje = new Date();
      hoje.setDate(hoje.getDate() + 90);
      return hoje.toISOString().split('T')[0];
    };

    return {
      // CORREÇÃO: Usar apenas numeroControlePNCP como chave única
      id_pncp: bid.numeroControlePNCP,
      titulo: bid.objetoCompra || 'Objeto não informado',
      orgao: bid.orgaoEntidade?.razaoSocial || 'Órgão não informado',
      modalidade: bid.modalidadeNome || 'Modalidade não informada',
      modalidade_codigo: bid.modalidadeId || null,
      data_publicacao: formatDate(bid.dataPublicacaoPncp),
      data_abertura_proposta: formatDate(bid.dataAberturaProposta),
      data_encerramento_proposta: formatDate(bid.dataEncerramentoProposta),
      data_expiracao: getDataExpiracao(),
      link_oficial: bid.linkSistemaOrigem || `https://pncp.gov.br/app/editais/${bid.orgaoEntidade?.cnpj}/${bid.anoCompra}/${bid.sequencialCompra}`,
      status: bid.situacaoCompraNome || 'Status não informado',
      municipio: bid.unidadeOrgao?.municipioNome || 'Município não informado',
      municipio_codigo_ibge: bid.unidadeOrgao?.codigoIbge || null,
      uf: bid.unidadeOrgao?.ufSigla || 'UF não informada',
      valor_estimado: bid.valorTotalEstimado ? parseFloat(bid.valorTotalEstimado) : null,
      processo: bid.processo || null,
      dados_completos: bid
    };
  });

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/licitacoes`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders,
        'Prefer': 'resolution=ignore-duplicates'
      },
      body: JSON.stringify(licitacoesFormatadas)
    });

    if (response.ok) {
      console.log(`✅ Salvadas ${licitacoesFormatadas.length} licitações`);
      return licitacoesFormatadas.length;
    } else {
      const responseText = await response.text();
      console.error('❌ Erro ao salvar:', response.status, responseText);
      return 0;
    }
  } catch (error) {
    console.error('❌ Erro ao salvar:', error);
    return 0;
  }
};

// ===================================================================
// FUNÇÕES DA API PNCP - CORRIGIDAS
// ===================================================================

const fetchWithRetry = async (url: string, retries = MAX_RETRIES): Promise<any> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Tentativa ${attempt}: ${url.substring(0, 100)}...`);
      
      const response = await fetch(url, { 
        signal: AbortSignal.timeout(10000), // ← Aumentado timeout
        headers: { 
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; PNCP-Client/1.0)'
        } 
      });
      
      if (response.ok) {
        const responseBody = await response.text();
        if (responseBody) {
          const data = JSON.parse(responseBody);
          console.log(`✅ ${data?.data?.length || 0} registros retornados`);
          return data;
        }
      } else if (response.status === 204) {
        console.log(`📭 Status 204 - sem resultados`);
        return { data: [], totalRegistros: 0, totalPaginas: 0 };
      } else if (response.status === 429) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`🚫 Rate limit - aguardando ${waitTime}ms...`);
        await delay(waitTime);
        continue;
      } else {
        console.error(`❌ Erro HTTP ${response.status}`);
      }
      
    } catch (error: any) {
      console.error(`💥 Erro tentativa ${attempt}:`, error.message);
      if (attempt === retries) throw error;
      await delay(1000 * attempt);
    }
  }
  
  return null;
};

// ===================================================================
// CORREÇÃO PRINCIPAL: Buscar TODAS as páginas para cada modalidade
// ===================================================================
const fetchAllPagesForModality = async (modalityCode: string, baseParams: URLSearchParams) => {
  const allData: any[] = [];
  let page = 1;
  let hasMorePages = true;

  console.log(`🎯 Buscando modalidade ${modalityCode}...`);

  while (hasMorePages) {
    const params = new URLSearchParams(baseParams);
    params.set('pagina', String(page));
    params.append('codigoModalidadeContratacao', modalityCode);
    params.append('tamanhoPagina', String(MAX_PAGE_SIZE)); // ← CORREÇÃO: Adicionar tamanhoPagina
    
    const url = `${PNCP_API_BASE_URL}?${params.toString()}`;
    
    await delay(DELAY_BETWEEN_REQUESTS);
    const data = await fetchWithRetry(url);
    
    if (data && data.data && data.data.length > 0) {
      allData.push(...data.data);
      console.log(`📄 Modalidade ${modalityCode} - Página ${page}: ${data.data.length} registros`);
      
      // Verificar se há mais páginas
      hasMorePages = page < (data.totalPaginas || 1);
      page++;
      
      // Proteção: não buscar mais de 10 páginas por modalidade
      if (page > 10) {
        console.log(`⚠️ Limitando busca a 10 páginas para modalidade ${modalityCode}`);
        hasMorePages = false;
      }
    } else {
      hasMorePages = false;
    }
  }

  console.log(`✅ Modalidade ${modalityCode}: Total de ${allData.length} registros coletados`);
  return allData;
};

// Buscar na API PNCP - CORREÇÃO: Buscar todas as páginas
const searchInPNCP = async (uf?: string, city?: string, keyword?: string) => {
  console.log('🌐 Buscando na API PNCP...');
  
  // SEMPRE buscar todas as modalidades
  const modalityCodes = ALL_MODALITY_CODES;
  console.log(`🎯 Buscando todas as modalidades: ${modalityCodes.join(', ')}`);

  // Parâmetros base - CORREÇÃO: Usar filtro de data mais amplo
  const baseParams = new URLSearchParams();
  const today = new Date();
  const pastDate = new Date();
  pastDate.setDate(today.getDate() - 30); // ← CORREÇÃO: Buscar últimos 30 dias
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + 60);
  
  // CORREÇÃO: Usar tanto dataInicial quanto dataFinal para pegar mais resultados
  baseParams.append('dataInicial', formatDateToYYYYMMDD(pastDate));
  baseParams.append('dataFinal', formatDateToYYYYMMDD(futureDate));

  if (city && city !== 'all') {
    baseParams.append('codigoMunicipioIbge', city);
  } else if (uf && uf !== 'all') {
    baseParams.append('uf', uf);
  }

  let allBids: any[] = [];
  
  // CORREÇÃO: Buscar TODAS as páginas por modalidade
  for (const modalityCode of modalityCodes) {
    try {
      const modalityData = await fetchAllPagesForModality(modalityCode, baseParams);
      allBids.push(...modalityData);
    } catch (error) {
      console.error(`❌ Erro modalidade ${modalityCode}:`, error);
    }
  }

  console.log(`📡 PNCP: ${allBids.length} licitações coletadas no total`);
  return allBids;
};

// ===================================================================
// HANDLER PRINCIPAL
// ===================================================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { 
    return res.status(200).end(); 
  }

  try {
    const { uf, city, page = '1', keyword } = req.query;
    const pageNum = parseInt(page as string, 10);

    console.log(`🚀 Busca híbrida: UF=${uf}, City=${city}, Keyword=${keyword}, Page=${pageNum}`);

    // ===================================================================
    // CORREÇÃO: Só buscar dados novos na primeira página
    // ===================================================================
    let supabaseResults = await searchInSupabase(uf as string, city as string, keyword as string);

    // OTIMIZAÇÃO: Só buscar no PNCP se for página 1 E se tiver poucos resultados
    if (pageNum === 1 && supabaseResults.length < 20) {
      console.log('🔄 Primeira página com poucos dados - buscando no PNCP...');
      const pncpResults = await searchInPNCP(uf as string, city as string, keyword as string);
      
      if (pncpResults.length > 0) {
        console.log(`💾 Encontrados ${pncpResults.length} novos registros no PNCP`);
        await saveToSupabase(pncpResults);
        
        // Buscar novamente no Supabase para pegar dados atualizados
        supabaseResults = await searchInSupabase(uf as string, city as string, keyword as string);
        console.log(`🔄 Dados atualizados: ${supabaseResults.length} resultados`);
      }
    }

    // ===================================================================
    // ETAPA 3: PROCESSAR E PAGINAR RESULTADOS
    // ===================================================================
    let allResults = supabaseResults;
    
    // Remover duplicatas baseado no id_pncp
    const uniqueResults = allResults.filter((item, index, self) => 
      index === self.findIndex(t => t.id_pncp === item.id_pncp)
    );

    // Ordenar por data de publicação (mais recente primeiro)
    uniqueResults.sort((a, b) => new Date(b.data_publicacao).getTime() - new Date(a.data_publicacao).getTime());

    // Paginação
    const itemsPerPage = 10;
    const totalPages = Math.ceil(uniqueResults.length / itemsPerPage);
    const startIndex = (pageNum - 1) * itemsPerPage;
    const paginatedResults = uniqueResults.slice(startIndex, startIndex + itemsPerPage);

    console.log(`✅ Página ${pageNum}/${totalPages}: Retornando ${paginatedResults.length} de ${uniqueResults.length} resultados únicos`);

    return res.status(200).json({
      data: paginatedResults,
      total: uniqueResults.length,
      totalPages,
      currentPage: pageNum,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
      source: pageNum === 1 ? 'hybrid' : 'supabase-only',
      warning: pageNum > 1 ? 'Dados da sessão anterior' : null,
      debug: {
        modalitiesSearched: ALL_MODALITY_CODES.length,
        maxPageSize: MAX_PAGE_SIZE
      }
    });

  } catch (error: any) {
    console.error("💥 Erro:", error);
    return res.status(500).json({ 
      error: error.message || 'Erro interno no servidor'
    });
  }
}
