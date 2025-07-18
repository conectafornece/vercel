import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_BASE_URL = "https://compras.dados.gov.br/contratos/v1/contratos.json";

// Mapeia os dados da API para o formato esperado pelo frontend
const mapBidData = (bid: any) => ({
  id_unico: bid.id || bid.numero_contrato || 'Não informado',
  titulo: bid.objeto_contrato || 'Não informado',
  orgao: bid.razao_social_orgao || bid.orgao || 'Não informado',
  modalidade: bid.nome_modalidade_licitacao || 'Não informada',
  data_publicacao: bid.data_assinatura || bid.data_publicacao,
  link_oficial: bid._links?.self?.href || `https://compras.dados.gov.br/contratos/doc/contrato/${bid.id}.html`,
  status: bid.situacao_contrato || 'Não informado',
  fonte: 'Compras.gov.br (Contratos)',
});

// Função para formatar data para YYYY-MM-DD
function getYYYYMMDD(date: Date): string {
  return date.toISOString().split('T')[0];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { modality, uf, city, page = '1', keyword } = req.query;
    const pageSize = 10;
    const offset = (parseInt(page as string) - 1) * pageSize;

    const params = new URLSearchParams();
    
    // Opcional: Adicionar um intervalo de datas pode ajudar a evitar timeouts
    // const today = new Date();
    // const pastDate = new Date();
    // pastDate.setDate(today.getDate() - 90);
    // params.append('data_assinatura_min', getYYYYMMDD(pastDate));
    // params.append('data_assinatura_max', getYYYYMMDD(today));
    
    params.append('offset', offset.toString());

    // --- CORREÇÃO APLICADA AQUI ---
    // O frontend já envia o código numérico correto (ex: '6').
    // O mapeamento foi removido para evitar inconsistências.
    if (modality && typeof modality === 'string' && modality !== 'all') {
      params.append('modalidade_licitacao', modality);
    }

    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('uf_orgao', uf.toUpperCase().trim());
    }
    
    // O código IBGE da cidade já é enviado corretamente pelo frontend
    if (city && typeof city === 'string' && city !== 'all') {
      params.append('municipio_orgao', city);
    }

    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      params.append('objeto', keyword.trim()); // O parâmetro para busca por palavra-chave é 'objeto'
    }
    
    const url = `${API_BASE_URL}?${params.toString()}`;
    console.log(`Fetching Compras.gov.br API with URL: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API Compras.gov.br: ${response.status} - ${url}`, errorText);
      // Retornar a mensagem de erro da API pode ajudar a depurar
      return res.status(response.status).json({ error: `Erro na API Compras.gov.br. Detalhes: ${errorText}` });
    }

    const rawData = await response.json();
    const resultsData = rawData._embedded?.contratos || [];
    
    // A API do Compras.gov.br retorna no máximo 500 resultados por consulta com offset.
    // O total real não é fornecido, então a paginação precisa ser estimada.
    const total = rawData.count || resultsData.length;
    const totalPages = Math.ceil(total / pageSize);

    const mappedData = resultsData.slice(0, pageSize).map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: total,
      totalPages: totalPages > 0 ? totalPages : 1,
    });

  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error("Fetch timeout na API Compras.gov.br");
      return res.status(504).json({ error: 'Timeout na requisição à API. Tente novamente ou ajuste os filtros.' });
    }
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
