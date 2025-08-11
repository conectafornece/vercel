import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';
const DELAY_BETWEEN_REQUESTS = 200;
const MAX_RETRIES = 3;
const MAX_PAGE_SIZE = 500;

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
// FUNÇÕES SUPABASE
// ===================================================================

const searchInSupabase = async (uf?: string, city?: string, keyword?: string) => {
  console.log('🔍 Buscando no Supabase...');
  
  try {
    let url = `${SUPABASE_URL}/rest/v1/licitacoes?select=*&order=data_publicacao.desc.nullslast&limit=200`;
    
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

const saveToSupabase = async (licitacoes: any[]) => {
  if (!licitacoes.length) return 0;
  
  console.log(`💾 Salvando ${licitacoes.length} licitações no Supabase...`);
  
  const licitacoesFormatadas = licitacoes.map(bid => {
    const formatDate = (dateString: string | null) => {
      if (!dateString) return null;
      try {
        return new Date(dateString).toISOString().split('T')[0];
      } catch {
        return null;
      }
    };

    const getDataExpiracao = () => {
      if (bid.dataEncerramentoProposta) {
        const dataEncerramento = new Date(bid.dataEncerramentoProposta);
        dataEncerramento.setDate(dataEncerramento.getDate() + 30);
        return dataEncerramento.toISOString().split('T')[0];
      }
      
      if (bid.dataAberturaProposta) {
        const dataAbertura = new Date(bid.dataAberturaProposta);
        dataAbertura.setDate(dataAbertura.getDate() + 60);
        return dataAbertura.toISOString().split('T')[0];
      }
      
      if (bid.dataPublicacaoPncp) {
        const dataPublicacao = new Date(bid.dataPublicacaoPncp);
        dataPublicacao.setDate(dataPublicacao.getDate() + 90);
        return dataPublicacao.toISOString().split('T')[0];
      }
      
      const hoje = new Date();
      hoje.setDate(hoje.getDate() + 90);
      return hoje.toISOString().split('T')[0];
    };

    return {
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
// FUNÇÕES DA API PNCP - CORRIGIDAS BASEADAS NO EXEMPLO QUE FUNCIONA
// ===================================================================

const fetchWithRetry = async (url: string, retries = MAX_RETRIES): Promise<any> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Tentativa ${attempt}: ${url}`);
      
      const response = await fetch(url, { 
        signal: AbortSignal.timeout(10000),
        headers: { 
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; PNCP-Client/1.0)'
        } 
      });
      
      if (response.ok) {
        const responseBody = await response.text();
        if (responseBody) {
          const data = JSON.parse(responseBody);
          console.log(`✅ ${data?.data?.length || 0} registros retornados (Total: ${data?.totalRegistros || 0})`);
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
        const errorBody = await response.text();
        console.error(`❌ Erro HTTP ${response.status}: ${errorBody}`);
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
// BUSCA CORRIGIDA - SEM MODALIDADE QUANDO FILTRAR POR LOCALIZAÇÃO
// ===================================================================
const searchInPNCP = async (uf?: string, city?: string, keyword?: string) => {
  console.log('🌐 Buscando na API PNCP...');
  
  const baseParams = new URLSearchParams();
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + 90); // Próximos 90 dias para pegar mais licitações
  
  // CORREÇÃO PRINCIPAL: Apenas dataFinal para endpoint /proposta
  baseParams.append('dataFinal', formatDateToYYYYMMDD(futureDate));
  baseParams.append('tamanhoPagina', String(MAX_PAGE_SIZE));

  // FILTROS GEOGRÁFICOS (como no exemplo que funciona)
  if (city && city !== 'all') {
    baseParams.append('codigoMunicipioIbge', city);
  } else if (uf && uf !== 'all') {
    baseParams.append('uf', uf);
  }

  let allBids: any[] = [];
  let page = 1;
  let hasMorePages = true;

  // Buscar múltiplas páginas
  while (hasMorePages && page <= 10) { // Limite de 10 páginas para segurança
    const params = new URLSearchParams(baseParams);
    params.append('pagina', String(page));
    
    const url = `${PNCP_API_BASE_URL}?${params.toString()}`;
    
    await delay(DELAY_BETWEEN_REQUESTS);
    const data = await fetchWithRetry(url);
    
    if (data && data.data && data.data.length > 0) {
      allBids.push(...data.data);
      console.log(`📄 Página ${page}: ${data.data.length} registros`);
      
      // Verificar se há mais páginas
      hasMorePages = page < (data.totalPaginas || 1);
      page++;
    } else {
      hasMorePages = false;
    }
  }

  console.log(`📡 PNCP: ${allBids.length} licitações coletadas no total`);
  
  // FILTRAR POR PALAVRA-CHAVE NO FRONTEND SE NECESSÁRIO
  if (keyword && keyword.trim() !== '') {
    const filtered = allBids.filter(bid => 
      bid.objetoCompra?.toLowerCase().includes(keyword.toLowerCase()) ||
      bid.orgaoEntidade?.razaoSocial?.toLowerCase().includes(keyword.toLowerCase())
    );
    console.log(`🔍 Filtrado por palavra-chave "${keyword}": ${filtered.length} resultados`);
    return filtered;
  }
  
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

    // Buscar no Supabase primeiro
    let supabaseResults = await searchInSupabase(uf as string, city as string, keyword as string);

    // Só buscar no PNCP se for primeira página E tiver poucos resultados
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

    // Remover duplicatas baseado no id_pncp
    const uniqueResults = supabaseResults.filter((item, index, self) => 
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
        endpoint: 'contratacoes/proposta',
        method: 'geographic_filter_without_modality'
      }
    });

  } catch (error: any) {
    console.error("💥 Erro:", error);
    return res.status(500).json({ 
      error: error.message || 'Erro interno no servidor'
    });
  }
}
