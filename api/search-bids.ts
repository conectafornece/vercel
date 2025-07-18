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
    const { modality, uf, city, page = '1' } = req.query;

    const params = new URLSearchParams();
    
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 90);
    
    params.append('dataPublicacaoPncpInicial', getYYYYMMDD(pastDate));
    params.append('dataPublicacaoPncpFinal', getYYYYMMDD(today));
    
    params.append('pagina', Array.isArray(page) ? page[0] : page);
    // Aumentamos o tamanho da página para melhorar a chance de encontrar a cidade no filtro manual
    params.append('tamanhoPagina', '100'); 

    let modalityCode = '6';
    if (modality && typeof modality === 'string' && modality !== 'all') {
      modalityCode = modalityMapping[modality] || modality;
    }
    params.append('codigoModalidade', modalityCode);

    // LÓGICA DE FILTRO FINAL:
    // 1. Sempre buscamos pelo ESTADO (UF), pois é o filtro mais confiável na API do PNCP.
    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('unidadeOrgaoUfSigla', uf.toUpperCase().trim());
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

    // 2. FILTRAGEM MANUAL PELA CIDADE:
    // Após receber os dados do estado, filtramos aqui pelo código IBGE da cidade.
    if (city && typeof city === 'string' && /^\d{7}$/.test(city)) {
        console.log(`Filtrando manualmente por cidade com código IBGE: ${city}`);
        resultsData = resultsData.filter((bid: any) => 
            // O campo correto na resposta desta API é 'unidadeOrgaoCodigolbge'
            bid.unidadeOrgaoCodigolbge?.toString() === city
        );
    }
    
    // Pegamos apenas os 10 primeiros resultados após a filtragem para enviar ao frontend
    const paginatedFilteredData = resultsData.slice(0, 10);
    
    const mappedData = paginatedFilteredData.map(mapBidData);

    // CORREÇÃO FINAL DA PAGINAÇÃO:
    // Se filtramos por cidade, o total de resultados e de páginas deve refletir
    // o total do ESTADO, para que o frontend possa navegar entre as páginas e
    // continuar a busca. No entanto, retornamos apenas os dados da cidade.
    // Se não houver filtro de cidade, os totais são os do estado mesmo.
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

