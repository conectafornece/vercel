import type { VercelRequest, VercelResponse } from '@vercel/node';

// Apontamos para a API de Dados Abertos do Compras.gov.br
const API_BASE_URL = "https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133";

// Mapeamento de modalidades para os códigos numéricos que a API exige.
const modalityMapping: { [key: string]: string } = {
  pregao_eletronico: '6',
  pregao_presencial: '7',
  concorrencia_eletronica: '4',
  concorrencia_presencial: '5',
  concurso: '3',
  leilao: '1',
  dialogo_competitivo: '2',
  dispensa_de_licitacao: '8',
  inexigibilidade: '9',
  credenciamento: '12',
};

// Mapeia os dados da API para o formato que o seu frontend espera.
const mapBidData = (comprasBid: any) => ({
  id_unico: comprasBid.numeroControlePNCP,
  titulo: comprasBid.objetoCompra,
  orgao: comprasBid.orgaoEntidadeRazaoSocial || 'Não informado',
  modalidade: comprasBid.modalidadeNome || 'Não informada',
  data_publicacao: comprasBid.dataPublicacaoPncp,
  link_oficial: `https://pncp.gov.br/app/contratacoes/${comprasBid.numeroControlePNCP}`,
  status: comprasBid.situacaoCompraNomePncp || 'Não informado',
  fonte: 'Compras.gov.br',
});

// Função para formatar a data para o padrão YYYY-MM-DD.
function getYYYYMMDD(date: Date): string {
  return date.toISOString().split('T')[0];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Configurações de CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { modality, uf, city, page = '1', keyword } = req.query;

    const params = new URLSearchParams();
    
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 90);
    
    params.append('dataPublicacaoPncpInicial', getYYYYMMDD(pastDate));
    params.append('dataPublicacaoPncpFinal', getYYYYMMDD(today));
    
    params.append('pagina', Array.isArray(page) ? page[0] : page);
    params.append('tamanhoPagina', '10'); 

    if (modality && typeof modality === 'string' && modality !== 'all') {
      const modalityCode = modalityMapping[modality] || modality;
      params.append('codigoModalidade', modalityCode);
    }

    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('unidadeOrgaoUfSigla', uf.toUpperCase().trim());
    }
    
    if (city && typeof city === 'string' && city !== 'all' && /^\d{7}$/.test(city)) {
      params.append('unidadeOrgaoCodigoIbge', city);
    }
    
    const url = `${API_BASE_URL}?${params.toString()}`;
    console.log(`Fetching Compras.gov.br API with URL: ${url}`);
    
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API Compras.gov.br: ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `Erro na API Compras.gov.br: ${errorText}` });
    }

    const rawData = await response.json();
    let resultsData = rawData.resultado || [];

    // Filtro manual por keyword (se fornecido), já que a API não suporta diretamente
    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      const lowerKeyword = keyword.toLowerCase().trim();
      resultsData = resultsData.filter((bid: any) => 
        bid.objetoCompra?.toLowerCase().includes(lowerKeyword)
      );
    }
    
    const mappedData = resultsData.map(mapBidData);

    // Totais baseados na resposta bruta da API (aproximados se keyword for usado)
    const totalForFrontend = rawData.totalRegistros || 0;
    const totalPagesForFrontend = rawData.totalPaginas || 0;

    return res.status(200).json({
      data: mappedData,
      total: totalForFrontend,
      totalPages: totalPagesForFrontend,
    });

  } catch (error: any) {
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
