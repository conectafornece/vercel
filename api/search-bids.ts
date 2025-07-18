import type { VercelRequest, VercelResponse } from '@vercel/node';

// 1. ENDPOINT CORRIGIDO: Apontamos para a API de Dados Abertos do Compras.gov.br,
// que tem um módulo específico para os dados do PNCP.
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

// Mapeia os dados da nova API para o formato que o seu frontend espera.
const mapBidData = (comprasBid: any) => ({
  id_unico: comprasBid.numeroControlePNCP,
  titulo: comprasBid.objetoCompra,
  orgao: comprasBid.orgaoEntidadeRazaoSocial || 'Não informado',
  modalidade: comprasBid.modalidadeNome || 'Não informada',
  data_publicacao: comprasBid.dataPublicacaoPncp,
  link_oficial: `https://pncp.gov.br/app/contratacoes/${comprasBid.numeroControlePNCP}`, // O link de detalhe ainda é no site do PNCP
  status: comprasBid.situacaoCompraNomePncp || 'Não informado',
  fonte: 'Compras.gov.br',
});

// Função para formatar a data para o padrão YYYY-MM-DD exigido pela nova API.
function getYYYYMMDD(date: Date): string {
  // A API de dados abertos espera o formato YYYY-MM-DD
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
    const { modality, uf, city, page = '1' } = req.query;

    const params = new URLSearchParams();
    
    // 2. PARÂMETROS ATUALIZADOS para a nova API
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 90);
    
    // Nomes dos parâmetros de data corrigidos
    params.append('dataPublicacaoPncpInicial', getYYYYMMDD(pastDate));
    params.append('dataPublicacaoPncpFinal', getYYYYMMDD(today));
    
    params.append('pagina', Array.isArray(page) ? page[0] : page);
    params.append('tamanhoPagina', '10');

    // A API exige um código de modalidade, então usamos um padrão se "todas" for selecionado.
    let modalityCode = '6'; // Pregão Eletrônico como fallback
    if (modality && typeof modality === 'string' && modality !== 'all') {
      modalityCode = modalityMapping[modality] || modality;
    }
    params.append('codigoModalidade', modalityCode); // Nome do parâmetro corrigido

    // Nome do parâmetro de UF corrigido
    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('unidadeOrgaoUfSigla', uf.toUpperCase().trim());
    }
    
    // Nome do parâmetro de cidade corrigido
    if (city && typeof city === 'string' && /^\d{7}$/.test(city)) {
        params.append('unidadeOrgaoCodigolbge', city);
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
    
    // 3. ESTRUTURA DE RESPOSTA ATUALIZADA
    const resultsData = rawData.resultado || [];
    
    const mappedData = resultsData.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: rawData.totalRegistros || 0,
      totalPages: rawData.totalPaginas || 0,
    });

  } catch (error: any) {
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
