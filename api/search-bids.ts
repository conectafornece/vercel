import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';
const ALL_MODALITY_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '12', '13'];
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
        'Prefer': 'resolution=ignore-duplicates' // CORREÇÃO: Ignorar duplicatas em vez de merge
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
// FUNÇÕES DA API PNCP
// ===================================================================

const fetchWithRetry = async (url: string, retries = MAX_RETRIES): Promise<any> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Tentativa ${attempt}: ${url.substring(0, 100)}...`);
      
      const response = await fetch(url, { 
        signal: AbortSignal.timeout(8000),
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

const fetchPageForModality = async (modalityCode: string, page: number, baseParams: URLSearchParams) => {
  const params = new URLSearchParams(baseParams);
  params.set('pagina', String(page));
  params.append('codigoModalidadeContratacao', modalityCode);
  
  const url = `${PNCP_API_BASE_URL}?${params.toString()}`;
  
  await delay(DELAY_BETWEEN_REQUESTS);
  return await fetchWithRetry(url);
};

// Buscar na API PNCP - SEMPRE busca todas as modalidades
const searchInPNCP = async (uf?: string, city?: string, keyword?: string) => {
  console.log('🌐 Buscando na API PNCP...');
  
  // SEMPRE buscar todas as modalidades - filtro será no frontend
  const modalityCodes = ALL_MODALITY_CODES;
  console.log(`🎯 Buscando todas as modalidades: ${modalityCodes.join(', ')}`);

  // Parâmetros base - CORREÇÃO: Remover filtro de data inicial para pegar mais resultados
  const baseParams = new URLSearchParams();
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + 60);
  
  // Apenas data final, sem data inicial para capturar mais licitações
  baseParams.append('dataFinal', formatDateToYYYYMMDD(futureDate));

  if (city && city !== 'all') {
    baseParams.append('codigoMunicipioIbge', city);
  } else if (uf && uf !== 'all') {
    baseParams.append('uf', uf);
  }

  let allBids: any[] = [];
  
  // Buscar por modalidade
  for (const modalityCode of modalityCodes) {
    try {
      const data = await fetchPageForModality(modalityCode, 1, baseParams);
      
      if (data && data.data) {
        allBids.push(...data.data);
        
        // Se tem palavra-chave, buscar mais páginas
        if (keyword && keyword.trim() !== '' && data.totalPaginas > 1) {
          const maxPages = Math.min(data.totalPaginas, 5);
          for (let page = 2; page <= maxPages; page++) {
            const pageData = await fetchPageForModality(modalityCode, page, baseParams);
            if (pageData && pageData.data) {
              allBids.push(...pageData.data);
            }
          }
        }
      }
    } catch (error) {
      console.error(`❌ Erro modalidade ${modalityCode}:`, error);
    }
  }

  console.log(`📡 PNCP: ${allBids.length} licitações coletadas`);
  return allBids;
};

// ===================================================================
// HANDLER PRINCIPAL - SEM FILTRO DE MODALIDADE
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

    console.log(`🚀 Busca híbrida: UF=${uf}, City=${city}, Keyword=${keyword}`);

    // ===================================================================
    // ETAPA 1: BUSCAR NO SUPABASE (sempre)
    // ===================================================================
    let supabaseResults = await searchInSupabase(uf as string, city as string, keyword as string);

    // ===================================================================
    // ETAPA 2: BUSCAR NA API PNCP (sempre)
    // ===================================================================
    console.log('🔄 Buscando dados atuais da API PNCP...');
    const pncpResults = await searchInPNCP(uf as string, city as string, keyword as string);
    
    if (pncpResults.length > 0) {
      console.log(`💾 Encontrados ${pncpResults.length} novos registros no PNCP`);
      await saveToSupabase(pncpResults);
      
      // Buscar novamente no Supabase para pegar dados atualizados
      supabaseResults = await searchInSupabase(uf as string, city as string, keyword as string);
      console.log(`🔄 Dados atualizados: ${supabaseResults.length} resultados`);
    }

    // ===================================================================
    // ETAPA 3: RETORNAR TODOS OS DADOS (sem filtro de modalidade)
    // ===================================================================
    let allResults = supabaseResults;
    
    // Remover duplicatas baseado no id_pncp
    const uniqueResults = allResults.filter((item, index, self) => 
      index === self.findIndex(t => t.id_pncp === item.id_pncp)
    );

    // Ordenar por data de publicação (mais recente primeiro)
    uniqueResults.sort((a, b) => new Date(b.data_publicacao).getTime() - new Date(a.data_publicacao).getTime());

    // Paginação básica
    const itemsPerPage = 20;
    const totalPages = Math.ceil(uniqueResults.length / itemsPerPage);
    const startIndex = (pageNum - 1) * itemsPerPage;
    const paginatedResults = uniqueResults.slice(startIndex, startIndex + itemsPerPage);

    console.log(`✅ Retornando ${paginatedResults.length} de ${uniqueResults.length} resultados únicos`);

    return res.status(200).json({
      data: paginatedResults,
      total: uniqueResults.length,
      totalPages,
      source: 'hybrid',
      supabaseCount: supabaseResults.length,
      pncpCount: pncpResults.length,
      warning: null
    });

  } catch (error: any) {
    console.error("💥 Erro:", error);
    return res.status(500).json({ 
      error: error.message || 'Erro interno no servidor'
    });
  }
}
