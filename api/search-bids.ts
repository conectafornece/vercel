import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_BASE_URL = "https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133";

// Lista com todos os códigos de modalidade que queremos pesquisar por padrão
const ALL_MODALITY_CODES = ['5', '6', '7', '4', '12', '20'];

const mapBidData = (contratacao: any) => ({
  id_unico: contratacao.idCompra,
  titulo: contratacao.objetoCompra,
  orgao: contratacao.orgaoEntidadeRazaoSocial,
  modalidade: contratacao.modalidadeNome,
  data_publicacao: contratacao.dataPublicacaoPncp,
  link_oficial: `https://www.gov.br/pncp/pt-br/contrato/-/contratos/${contratacao.numeroControlePNCP}`,
  status: contratacao.situacaoCompraNomePncp,
  municipio: contratacao.unidadeOrgaoMunicipioNome,
  municipio_codigo_ibge: contratacao.unidadeOrgaoCodigolbge,
  uf: contratacao.unidadeOrgaoUfSigla,
  fonte: 'Compras.gov.br (PNCP)',
});

function getYYYYMMDD(date: Date): string {
  return date.toISOString().split('T')[0];
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

    // Define quais modalidades serão buscadas. Se 'all' ou vazio, busca em todas.
    if (!modality || modality === 'all' || modality === '') {
      modalityCodes = ALL_MODALITY_CODES;
    } else {
      modalityCodes = (modality as string).split(',');
    }

    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 30);

    // Função interna para buscar os dados de uma única modalidade
    const fetchBidsForModality = async (modalityCode: string) => {
      const params = new URLSearchParams();
      params.append('dataPublicacaoPncpInicial', getYYYYMMDD(pastDate));
      params.append('dataPublicacaoPncpFinal', getYYYYMMDD(today));
      params.append('pagina', page as string);
      params.append('codigoModalidade', modalityCode);
      
      // Lógica de localização (UF ou Cidade)
      if (city && city !== 'all') {
        params.append('unidadeOrgaoCodigoIbge', city as string);
      } else if (uf && uf !== 'all') {
        params.append('unidadeOrgaoUfSigla', uf as string);
      }

      const url = `${API_BASE_URL}?${params.toString()}`;
      console.log(`Disparando busca para modalidade ${modalityCode}: ${url}`);

      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });

      if (!response.ok) {
        console.error(`Erro ao buscar modalidade ${modalityCode}. Status: ${response.status}`);
        return null;
      }
      return response.json();
    };

    // Cria e executa todas as buscas em paralelo
    const promises = modalityCodes.map(code => fetchBidsForModality(code));
    const results = await Promise.allSettled(promises);

    // Agrega os resultados de todas as buscas bem-sucedidas
    let allBids: any[] = [];
    let totalAggregatedResults = 0;
    let maxTotalPages = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        const data = result.value;
        allBids.push(...(data.resultado || []));
        totalAggregatedResults += data.totalRegistros || 0;
        if ((data.totalPaginas || 0) > maxTotalPages) {
            maxTotalPages = data.totalPaginas;
        }
      } else if (result.status === 'rejected') {
        console.error(`A requisição para a modalidade ${modalityCodes[index]} falhou:`, result.reason);
      }
    });
    
    // --- LÓGICA DE FILTRO POR PALAVRA-CHAVE (CONDICIONAL) ---
    let filteredBids = allBids;
    // O filtro só é aplicado se uma CIDADE for selecionada, para garantir
    // que estamos trabalhando com um conjunto de dados preciso e relevante.
    if (city && city !== 'all' && keyword && typeof keyword === 'string' && keyword.trim() !== '') {
        const lowercasedKeyword = keyword.trim().toLowerCase();
        filteredBids = allBids.filter(bid =>
            (bid.objetoCompra && bid.objetoCompra.toLowerCase().includes(lowercasedKeyword)) ||
            (bid.orgaoEntidadeRazaoSocial && bid.orgaoEntidadeRazaoSocial.toLowerCase().includes(lowercasedKeyword))
        );
    } else if (!city || city === 'all' && keyword && typeof keyword === 'string' && keyword.trim() !== '') {
        const lowercasedKeyword = keyword.trim().toLowerCase();
        filteredBids = allBids.filter(bid =>
            (bid.objetoCompra && bid.objetoCompra.toLowerCase().includes(lowercasedKeyword)) ||
            (bid.orgaoEntidadeRazaoSocial && bid.orgaoEntidadeRazaoSocial.toLowerCase().includes(lowercasedKeyword))
        );
    }
    
    // Ordena os resultados finais por data de publicação (mais recente primeiro)
    filteredBids.sort((a, b) => new Date(b.dataPublicacaoPncp).getTime() - new Date(a.dataPublicacaoPncp).getTime());

    const mappedData = filteredBids.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: totalAggregatedResults, // Total de resultados ANTES do filtro de palavra-chave
      totalPages: maxTotalPages > 0 ? maxTotalPages : 1,
    });

  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error("Timeout na API Compras.gov.br (Contratações)");
      return res.status(504).json({ error: 'Timeout na requisição à API. Tente novamente ou ajuste os filtros.' });
    }
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
