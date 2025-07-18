import type { VercelRequest, VercelResponse } from '@vercel/node';

// 1. MUDANÇA FUNDAMENTAL: Apontamos para o endpoint oficial e atual do Compras.gov.br
const API_BASE_URL = "https://dadosabertos.compras.gov.br/modulo-contratacoes/v1/contratacoes";

// Mapeia os dados da nova API para o formato que o seu frontend espera.
const mapBidData = (comprasBid: any) => ({
  id_unico: comprasBid.numero_controle_pncp,
  titulo: comprasBid.objeto,
  orgao: comprasBid.orgao?.nome_orgao || 'Não informado',
  modalidade: comprasBid.modalidade?.nome || 'Não informada',
  data_publicacao: comprasBid.data_publicacao,
  // A nova API fornece o link direto para o PNCP
  link_oficial: comprasBid._links?.pncp?.href || '#', 
  status: comprasBid.situacao?.nome || 'Não informado',
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
    
    params.append('data_inicio', getYYYYMMDD(pastDate));
    params.append('data_fim', getYYYYMMDD(today));
    params.append('pagina', Array.isArray(page) ? page[0] : page);
    params.append('tamanho', '100'); // Buscamos o máximo para ter mais chance na filtragem manual

    if (modality && typeof modality === 'string' && modality !== 'all') {
      params.append('modalidade', modality);
    }

    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('unidade_orgao_uf', uf.toUpperCase().trim());
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
    let resultsData = rawData._embedded?.contratacoes || [];

    // 4. FILTRAGEM MANUAL PELA CIDADE (a abordagem robusta e correta)
    // Após receber os dados do estado, filtramos aqui pelo CÓDIGO IBGE da cidade.
    if (city && typeof city === 'string' && /^\d{7}$/.test(city)) {
        resultsData = resultsData.filter((bid: any) => 
            bid.unidade_orgao?.municipio?.codigo_ibge === city
        );
    }
    
    const mappedData = resultsData.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      // Usamos os totais da API original para o frontend saber que existem mais páginas
      total: rawData.page?.totalElements || 0,
      totalPages: rawData.page?.totalPages || 0,
    });

  } catch (error: any) {
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
