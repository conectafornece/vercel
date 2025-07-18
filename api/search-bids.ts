import type { VercelRequest, VercelResponse } from '@vercel/node';

// URL base da API Compras.gov.br para Licitações
const API_BASE_URL = "https://compras.dados.gov.br/licitacoes/v1/licitacoes.json";

// Mapeia os dados da API de licitações para o formato esperado pelo seu frontend
const mapBidData = (licitacao: any) => ({
  id_unico: licitacao.identificador,
  titulo: licitacao.objeto || 'Não informado',
  orgao: licitacao.nome_orgao || 'Não informado',
  modalidade: licitacao.modalidade_nome || 'Não informada',
  data_publicacao: licitacao.data_publicacao_pncp,
  // O link do PNCP é o mais indicado para detalhes da licitação
  link_oficial: licitacao.link_pncp || licitacao._links?.self?.href,
  status: licitacao.situacao_licitacao_nome || 'Não informado',
  // Adiciona informações úteis para o frontend
  data_abertura: licitacao.data_abertura_proposta,
  municipio: licitacao.municipio_orgao_licitante,
  uf: licitacao.uf_orgao_licitante,
  fonte: 'Compras.gov.br (Licitações)',
});

// Função para formatar data para YYYY-MM-DD
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
    const { modality, uf, city, page = '1', keyword } = req.query;
    const pageSize = 10;
    const offset = (parseInt(page as string, 10) - 1) * pageSize;

    const params = new URLSearchParams();
    
    // --- LÓGICA DE FILTRO ATUALIZADA ---
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 30);

    // 1. Filtra por licitações PUBLICADAS nos últimos 30 dias
    params.append('data_publicacao_pncp_min', getYYYYMMDD(pastDate));
    params.append('data_publicacao_pncp_max', getYYYYMMDD(today));

    // 2. Garante que a licitação ainda está "em aberto" (data de abertura de propostas é hoje ou no futuro)
    params.append('data_abertura_proposta_min', getYYYYMMDD(today));
    
    params.append('offset', offset.toString());

    // --- PARÂMETROS DA API DE LICITAÇÕES ---
    if (modality && typeof modality === 'string' && modality !== 'all') {
      // O nome do parâmetro é 'codigo_modalidade'
      params.append('codigo_modalidade', modality);
    }

    if (uf && typeof uf === 'string' && uf !== 'all') {
      // O nome do parâmetro é 'uf_orgao_licitante'
      params.append('uf_orgao_licitante', uf.toUpperCase().trim());
    }
    
    if (city && typeof city === 'string' && city !== 'all') {
      // O nome do parâmetro é 'codigo_municipio_ibge_orgao_licitante'
      params.append('codigo_municipio_ibge_orgao_licitante', city);
    }

    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      params.append('objeto', keyword.trim());
    }
    
    const url = `${API_BASE_URL}?${params.toString()}`;
    console.log(`Buscando na API de Licitações com a URL: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API Compras.gov.br (Licitações): ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `Erro na API de Licitações. Detalhes: ${errorText}` });
    }

    const rawData = await response.json();
    // A estrutura da resposta é diferente: os dados estão em _embedded.licitacoes
    const resultsData = rawData._embedded?.licitacoes || [];
    
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
      console.error("Timeout na API Compras.gov.br (Licitações)");
      return res.status(504).json({ error: 'Timeout na requisição à API. Tente novamente ou ajuste os filtros.' });
    }
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
