import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_BASE_URL = "https://pncp.gov.br/api/consulta";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Extrai os parâmetros da query. Garante que sejam strings.
    const { keyword, modality, uf, city } = req.query;

    const params = new URLSearchParams();

    // Monta os parâmetros da URL para a API PNCP
    if (keyword && typeof keyword === 'string') {
      params.append('palavraChave', keyword);
    }
    if (modality && typeof modality === 'string' && modality !== 'all') {
      params.append('modalidade', modality);
    }
    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('codigoUF', uf);
    }
    if (city && typeof city === 'string' && city !== 'all') {
      params.append('codigoMunicipio', city);
    }

    const url = `${PNCP_BASE_URL}/v1/licitacoes?${params.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      // Se a resposta da API externa não for bem-sucedida, capture o texto do erro
      const errorText = await response.text();
      console.error(`Erro na API PNCP: ${errorText}`);
      return res.status(response.status).json({ 
        error: `Erro ao consultar a API externa.`, 
        details: errorText 
      });
    }

    const data = await response.json();
    
    return res.status(200).json(data);

  } catch (error: any) {
    // Captura qualquer outro erro inesperado no servidor
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido.';
    return res.status(500).json({ error: 'Erro interno no servidor.', details: errorMessage });
  }
}
  }
}
