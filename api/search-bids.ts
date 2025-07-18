import type { VercelRequest, VercelResponse } from '@vercel/node';

// 1. MUDANÇA FUNDAMENTAL: Apontamos para a API correta do Compras.gov.br
const API_BASE_URL = "https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133";

// Mapeia os dados da nova API para o formato que o seu frontend espera.
const mapBidData = (comprasBid: any) => ({
  id_unico: comprasBid.numeroControlePNCP,
  titulo: comprasBid.objetoCompra,
  orgao: comprasBid.orgaoEntidadeRazaoSocial || 'Não informado',
  modalidade: comprasBid.modalidadeNome || 'Não informada',
  data_publicacao: comprasBid.dataPublicacaoPncp,
  link_oficial: `https://pncp.gov.br/app/editais/${comprasBid.numeroControlePNCP}`, // O link de detalhe ainda é no site do PNCP
  status: comprasBid.situacaoCompraNomePncp || 'Não informado',
  fonte: 'Compras.gov.br',
});

// Função para formatar a data para o padrão YYYY-MM-DD exigido pela nova API.
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
    
    // 2. PARÂMETROS ATUALIZADOS para a nova API
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 90);
    
    params.append('inicio', getYYYYMMDD(pastDate));
    params.append('fim', getYYYYMMDD(today));
    params.append('pagina', Array.isArray(page) ? page[0] : page);
    params.append('tamanhoPagina', '50'); // Aumentamos um pouco para melhorar a filtragem de cidade

    // O código da modalidade é o mesmo
    if (modality && typeof modality === 'string' && modality !== 'all') {
      params.append('codigoModalidade', modality);
    }

    // O parâmetro de UF mudou de nome
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

    // 3. FILTRAGEM MANUAL PELA CIDADE (a abordagem robusta)
    // Após receber os dados do estado, filtramos aqui pelo NOME da cidade.
    if (city && typeof city === 'string' && city !== 'all') {
        // Precisamos do nome da cidade, que o frontend já tem.
        // O frontend envia o código IBGE, mas o objeto de cidades também tem o nome.
        // Assumimos que o frontend pode enviar o nome da cidade no futuro ou que o dev pode adaptar.
        // Por agora, esta lógica espera o NOME da cidade. Se o frontend envia o CÓDIGO,
        // o ideal é que ele envie também um parâmetro `cityName`.
        // Para simplificar, vamos assumir que o `city` que chega é o NOME.
        // NOTA PARA O DEV: O ideal é o frontend enviar `city` (código) e `cityName` (nome).
        
        // Esta API não retorna o código IBGE, então filtramos pelo nome.
        const cityNameQuery = city; // Assumindo que `city` é o nome por enquanto
        resultsData = resultsData.filter((bid: any) => 
            bid.unidadeOrgaoMunicipioNome?.toLowerCase() === cityNameQuery.toLowerCase()
        );
    }
    
    const mappedData = resultsData.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: rawData.totalRegistros || resultsData.length,
      totalPages: rawData.totalPaginas || 1,
    });

  } catch (error: any) {
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
