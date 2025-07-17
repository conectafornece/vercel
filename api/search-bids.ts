import type { VercelRequest, VercelResponse } from '@vercel/node';

// Endpoint correto para propostas abertas
const PNCP_BASE_URL = "https://pncp.gov.br/pncp-consulta/v1/contratacoes/proposta";

// Mapeamento de modalidades para os códigos da API PNCP (contratação)
const modalityMapping: { [key: string]: string } = {
  pregao: '5',
  concorrencia: '6',
  concurso: '7',
  leilao: '8',
  dialogo_competitivo: '9',
};

// Mapeia os dados da API para o formato que o seu componente espera
const mapBidData = (pncpBid: any) => ({
  id_unico: pncpBid.numeroCompra,
  titulo: pncpBid.objetoCompra,
  orgao: pncpBid.orgaoEntidade?.razaoSocial || pncpBid.orgaoEntidade?.nome || 'Não informado',
  modalidade: pncpBid.modalidadeContratacao?.nome || 'Não informada',
  data_publicacao: pncpBid.dataPublicacaoPncp,
  link_oficial: `https://pncp.gov.br/app/contratacoes/${pncpBid.numeroCompra}`,
  status: pncpBid.situacaoCompra?.nome || 'Não informado',
  fonte: 'PNCP',
});

function getTodayYYYYMMDD() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Headers CORS para permitir a comunicação com seu app
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { keyword, modality, uf, city, page = '1' } = req.query;

    // Só faz a requisição se pelo menos um filtro for preenchido
    if (
      (!keyword || keyword === '') &&
      (!modality || modality === 'all') &&
      (!uf || uf === 'all') &&
      (!city || city === 'all')
    ) {
      return res.status(400).json({ error: 'Pelo menos um filtro deve ser preenchido para buscar licitações.' });
    }

    const params = new URLSearchParams();
    params.append('pagina', Array.isArray(page) ? page[0] : page);
    params.append('tamanhoPagina', '10');

    // Filtro obrigatório para propostas abertas
    params.append('dataFinal', getTodayYYYYMMDD());

    if (keyword && typeof keyword === 'string') {
      params.append('palavraChave', keyword);
    }
    if (modality && typeof modality === 'string' && modality !== 'all' && modalityMapping[modality]) {
      params.append('codigoModalidadeContratacao', modalityMapping[modality]);
    }
    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('codigoUf', uf);
    }
    if (city && typeof city === 'string' && city !== 'all') {
      params.append('codigoMunicipio', city);
    }

    const url = `${PNCP_BASE_URL}?${params.toString()}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API PNCP: ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `Erro na API PNCP: ${errorText}` });
    }

    const rawData = await response.json();
    
    const mappedData = (rawData.data || []).map(mapBidData);

    return res.status(200).json({
        data: mappedData,
        total: rawData.totalRegistros || rawData.total || 0,
        totalPages: rawData.totalPaginas || Math.ceil((rawData.totalRegistros || 0) / 10)
    });

  } catch (error: any) {
    console.error("Erro interno na função serverless:", error);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
