import type { VercelRequest, VercelResponse } from '@vercel/node';

// ===================================================================
// MUDANÇA 1: Usando a API de BUSCA REAL do portal PNCP
// ===================================================================
const PNCP_SEARCH_API_URL = 'https://pncp.gov.br/api/search/';

// ===================================================================
// MUDANÇA 2: Mapeamento de dados para a nova estrutura da API de Busca
// ===================================================================
const mapBidData = (item: any) => ({
  id_unico: item.id,
  titulo: item.title || item.description || 'Objeto não informado',
  orgao: item.orgao_nome || 'Órgão não informado',
  modalidade: item.modalidade_nome || 'Modalidade não informada',
  data_publicacao: item.createdAt, // A API de busca usa 'createdAt'
  link_oficial: `https://www.gov.br/pncp/pt-br${item.item_url}`, // A API de busca já fornece a URL relativa
  status: 'Recebendo Propostas', // O status é definido pelo nosso filtro
  municipio: item.municipio_nome || 'Município não informado',
  municipio_codigo_ibge: item.municipio_id,
  uf: item.uf,
  fonte: 'PNCP (Busca Real)',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { modality, uf, city, page = '1', keyword } = req.query;

    const params = new URLSearchParams();
    
    // ===================================================================
    // MUDANÇA 3: Usando os parâmetros corretos para a API de Busca
    // ===================================================================
    params.append('status', 'recebendo_proposta'); // Filtro essencial para licitações ativas
    params.append('pagina', page as string);

    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      params.append('q', keyword.trim()); // O parâmetro de busca é 'q'
    }

    if (modality && typeof modality === 'string' && modality !== 'all') {
      const modalityCodes = modality.split(',');
      modalityCodes.forEach(code => {
        // O nome do parâmetro de modalidade também pode ser diferente, 'modalidades' é um bom palpite
        params.append('modalidades', code);
      });
    }

    if (city && city !== 'all') {
      params.append('municipios', city as string); // O parâmetro de cidade é 'municipios'
    } else if (uf && uf !== 'all') {
      params.append('ufs', uf as string); // O parâmetro de estado é 'ufs'
    }
    // ===================================================================
    // FIM DA MUDANÇA 3
    // ===================================================================

    const url = `${PNCP_SEARCH_API_URL}?${params.toString()}`;
    console.log(`Buscando na API de BUSCA do PNCP: ${url}`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `A API de Busca do PNCP retornou um erro. Detalhes: ${errorText}` });
    }

    const responseBody = await response.text();
    if (!responseBody) {
      return res.status(200).json({ data: [], total: 0, totalPages: 0 });
    }

    const rawData = JSON.parse(responseBody);
    
    // A estrutura da resposta é { items: [], total: X }
    const resultsData = rawData.items || [];
    const mappedData = resultsData.map(mapBidData);

    // A API de busca não fornece o total de páginas, calculamos manualmente
    const totalResults = rawData.total || 0;
    const totalPages = Math.ceil(totalResults / 10); // Assumindo 10 itens por página

    return res.status(200).json({
      data: mappedData,
      total: totalResults,
      totalPages: totalPages,
    });

  } catch (error: any) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return res.status(504).json({ error: 'A busca demorou demais para responder (Timeout).' });
    }
    if (error instanceof SyntaxError) {
        return res.status(502).json({ error: 'A API do governo retornou uma resposta inválida.' });
    }
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
