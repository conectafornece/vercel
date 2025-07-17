import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_BASE_URL = "https://pncp.gov.br/api/consulta";

// Mapeamento de modalidades para os códigos da API PNCP
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
  orgao: pncpBid.orgaoEntidade?.nome || 'Não informado',
  modalidade: pncpBid.modalidadeLicitacao?.nome || 'Não informada',
  data_publicacao: pncpBid.dataPublicacaoPncp,
  link_oficial: `https://pncp.gov.br/app/compras/${pncpBid.numeroCompra}`,
  status: pncpBid.situacaoCompra?.nome || 'Não informado',
  fonte: 'PNCP',
});

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

    const params = new URLSearchParams();
    params.append('pagina', Array.isArray(page) ? page[0] : page);
    params.append('tamanhoPagina', '10');

    if (keyword && typeof keyword === 'string') {
      params.append('palavraChave', keyword);
    }
    if (modality && typeof modality === 'string' && modality !== 'all' && modalityMapping[modality]) {
      params.append('codigoModalidadeLicitacao', modalityMapping[modality]);
    }
    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('codigoUf', uf);
    }
    if (city && typeof city === 'string' && city !== 'all') {
      params.append('codigoMunicipio', city);
    }

    const url = `${PNCP_BASE_URL}/v1/compras?${params.toString()}`;
    
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
        total: rawData.total,
        totalPages: Math.ceil(rawData.total / parseInt(params.get('tamanhoPagina') || '10'))
    });

  } catch (error: any) {
    console.error("Erro interno na função serverless:", error);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
