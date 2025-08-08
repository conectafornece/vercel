import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';
const ALL_MODALITY_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '12', '13'];
const MAX_PAGES_TO_FETCH = 100; // Limite de segurança para evitar timeouts

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

// ===================================================================
// CORREÇÃO 3: Função melhorada com rate limiting e retry
// ===================================================================
const fetchPageForModality = async (modalityCode: string, page: number, baseParams: URLSearchParams, retryCount = 0) => {
    const params = new URLSearchParams(baseParams);
    params.set('pagina', String(page));
    params.append('codigoModalidadeContratacao', modalityCode);
    
    const url = `${PNCP_API_BASE_URL}?${params.toString()}`;
    
    console.log(`Buscando: Mod. ${modalityCode}, Pág. ${page}, URL: ${url}`);
    
    try {
        // ===================================================================
        // CORREÇÃO 4: Delay entre requisições para evitar rate limiting
        // ===================================================================
        if (retryCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
        
        const response = await fetch(url, { 
            signal: AbortSignal.timeout(15000), 
            headers: { 
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; PNCP-Client/1.0)'
            } 
        });
        
        if (response.status === 429 && retryCount < 3) {
            console.log(`Rate limited. Tentativa ${retryCount + 1}/3 para Mod. ${modalityCode}, Pág. ${page}`);
            return await fetchPageForModality(modalityCode, page, baseParams, retryCount + 1);
        }
        
        if (!response.ok) {
            console.error(`Erro na API para Mod. ${modalityCode}, Pág. ${page}. Status: ${response.status}`);
            return null;
        }
        
        const responseBody = await response.text();
        if (!responseBody) return null;
        
        return JSON.parse(responseBody);
    } catch (error) {
        console.error(`Erro na requisição para Mod. ${modalityCode}, Pág. ${page}:`, error);
        return null;
    }
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
    
    // ===================================================================
    // CORREÇÃO 1: Usar apenas dataFinal (parâmetro obrigatório)
    // ===================================================================
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 60);
    baseParams.append('dataFinal', formatDateToYYYYMMDD(futureDate));
    
    // ===================================================================
    // CORREÇÃO 2: Filtros de localização mais conservadores
    // ===================================================================
    if (city && city !== 'all' && city !== '') {
      baseParams.append('codigoMunicipioIbge', city as string);
    } else if (uf && uf !== 'all' && uf !== '') {
      baseParams.append('uf', uf as string);
    }

    // ===================================================================
    // CORREÇÃO 5: Buscar modalidades de forma sequencial para evitar rate limiting
    // ===================================================================
    let allBids: any[] = [];
    let totalAggregatedResults = 0;

    console.log(`Iniciando busca para modalidades: ${modalityCodes.join(', ')}`);

    for (const modalityCode of modalityCodes) {
        try {
            console.log(`Processando modalidade ${modalityCode}...`);
            
            const firstPageResult = await fetchPageForModality(modalityCode, 1, baseParams);
            
            if (firstPageResult && firstPageResult.data) {
                const bidsFromResult = firstPageResult.data || [];
                allBids.push(...bidsFromResult);
                totalAggregatedResults += firstPageResult.totalRegistros || 0;
                
                console.log(`Modalidade ${modalityCode}: ${bidsFromResult.length} licitações na primeira página`);
                
                const totalPages = firstPageResult.totalPaginas || 0;
                
                // Buscar páginas adicionais se necessário
                if (totalPages > 1) {
                    const pagesToFetch = Math.min(totalPages, 10); // Limitar a 10 páginas por modalidade
                    
                    for (let page = 2; page <= pagesToFetch; page++) {
                        const pageResult = await fetchPageForModality(modalityCode, page, baseParams);
                        if (pageResult && pageResult.data) {
                            allBids.push(...(pageResult.data || []));
                        }
                        
                        // Delay entre páginas para evitar rate limiting
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }
            }
            
            // Delay entre modalidades
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (error) {
            console.error(`Erro ao processar modalidade ${modalityCode}:`, error);
        }
    }
    
    console.log(`Total de ${allBids.length} licitações recebidas da API antes do filtro de palavra-chave.`);

    // ===================================================================
    // MUDANÇA 2: Filtro de palavra-chave melhorado
    // ===================================================================
    let filteredBids = allBids;
    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
        const lowercasedKeyword = keyword.trim().toLowerCase();
        filteredBids = allBids.filter(bid => {
            // Buscar no objeto da compra
            const objetoMatch = bid.objetoCompra && 
                bid.objetoCompra.toLowerCase().includes(lowercasedKeyword);
            
            // Buscar na razão social do órgão
            const orgaoMatch = bid.orgaoEntidade?.razaoSocial && 
                bid.orgaoEntidade.razaoSocial.toLowerCase().includes(lowercasedKeyword);
            
            // Buscar também no processo e outros campos relevantes
            const processoMatch = bid.processo && 
                bid.processo.toLowerCase().includes(lowercasedKeyword);
                
            const modalidadeMatch = bid.modalidadeNome && 
                bid.modalidadeNome.toLowerCase().includes(lowercasedKeyword);
                
            const situacaoMatch = bid.situacaoCompraNome && 
                bid.situacaoCompraNome.toLowerCase().includes(lowercasedKeyword);
            
            return objetoMatch || orgaoMatch || processoMatch || modalidadeMatch || situacaoMatch;
        });
    }
    
    console.log(`Total de ${filteredBids.length} licitações após aplicar o filtro "${keyword}".`);
    
    // ===================================================================
    // MUDANÇA 3: Ordenação melhorada
    // ===================================================================
    filteredBids.sort((a, b) => {
        const dateA = new Date(a.dataPublicacaoPncp || a.dataInclusao);
        const dateB = new Date(b.dataPublicacaoPncp || b.dataInclusao);
        return dateB.getTime() - dateA.getTime();
    });

    const finalPage = parseInt(page as string, 10);
    const itemsPerPage = 10;
    const paginatedItems = filteredBids.slice((finalPage - 1) * itemsPerPage, finalPage * itemsPerPage);
    
    const mappedData = paginatedItems.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      // ===================================================================
      // MUDANÇA 4: Retornar total filtrado, não agregado
      // ===================================================================
      total: filteredBids.length,
      totalPages: Math.ceil(filteredBids.length / itemsPerPage) || 1,
      // ===================================================================
      // MUDANÇA 5: Dados de debug (opcional - pode remover em produção)
      // ===================================================================
      debug: {
        totalFromAPI: allBids.length,
        totalFiltered: filteredBids.length,
        keyword: keyword,
        modalityCodes: modalityCodes,
        uf: uf,
        city: city
      }
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
