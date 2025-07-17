import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_BASE_URL = "https://pncp.gov.br/api/consulta";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { keyword, modality, uf, city } = req.query;

    // Monta os parâmetros da URL para a API PNCP
    const params = new URLSearchParams();

    if (keyword && typeof keyword === 'string') {
      params.append('palavraChave', keyword);
    }
    if (modality && typeof modality === 'string' && modality !== 'all') {
      params.append('modalidade', modality);
    }
    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('codigoUf', uf);
    }
    if (city && typeof city === 'string' && city !== 'all') {
      params.append('codigoMunicipio', city);
    }

    const url = `${PNCP_BASE_URL}/v1/licitacoes?${params.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Erro na API PNCP: ${errorText}` });
    }

    const data = await response.json();

    return res.status(200).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
