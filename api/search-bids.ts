import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_BASE_URL = "https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133";

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
    const { modality, uf, city, page = '1' } = req.query;

    if (!modality || (Array.isArray(modality) && modality.length === 0) || modality === '') {
        return res.status(400).json({ error: 'Por favor, selecione pelo menos uma modalidade de contratação para realizar a busca.' });
    }

    // A API agora espera uma string separada por vírgulas, ex: "5,6,7"
    const modalityCodes = (modality as string).split(',');

    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 30);

    // Criar uma função para buscar os dados de uma única modalidade
    const fetchBidsForModality = async (modalityCode: string) => {
      const params = new URLSearchParams();
      params.append('dataPublicacaoPncpInicial', getYYYYMMDD(pastDate));
      params.append('dataPublicacaoPncpFinal', getYYYYMMDD(today));
      params.append('pagina', page as string);
      
      // Adiciona o código da modalidade para esta requisição específica
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
        // Se falhar, loga o erro mas não quebra a execução para as outras modalidades
        console.error(`Erro ao buscar modalidade ${modalityCode}. Status: ${response.status}`);
        return null; // Retorna nulo para indicar falha
      }
      return response.json();
    };

    // Criar um array de promessas, uma para cada modalidade selecionada
    const promises = modalityCodes.map(code => fetchBidsForModality(code));

    // Executar todas as promessas em paralelo e esperar os resultados
    const results = await Promise.allSettled(promises);

    let allBids: any[] = [];
    let totalAggregatedResults = 0;
    let maxTotalPages = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        const data = result.value;
        const bidsFromResult = data.resultado || [];
        allBids = [...allBids, ...bidsFromResult];
        
        totalAggregatedResults += data.totalRegistros || 0;
        if ((data.totalPaginas || 0) > maxTotalPages) {
            maxTotalPages = data.totalPaginas;
        }
      } else if (result.status === 'rejected') {
        console.error(`A requisição para a modalidade ${modalityCodes[index]} falhou:`, result.reason);
      }
    });
    
    // Ordenar os resultados consolidados por data de publicação (mais recente primeiro)
    allBids.sort((a, b) => new Date(b.dataPublicacaoPncp).getTime() - new Date(a.dataPublicacaoPncp).getTime());

    const mappedData = allBids.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: totalAggregatedResults,
      totalPages: maxTotalPages > 0 ? maxTotalPages : 1,
    });

  } catch (error: any) {
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
