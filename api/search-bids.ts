import type { VercelRequest, VercelResponse } from '@vercel/node';

// URL base da API Compras.gov.br para licitações
const API_BASE_URL = "https://compras.dados.gov.br/licitacoes/v1/licitacoes.json";

// Mapeamento de modalidades (códigos da API Compras.gov.br)
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

// Mapeia os dados da API para o formato esperado pelo frontend
const mapBidData = (bid: any) => ({
  id_unico: bid.id || bid.numeroControle,  // Ajuste baseado em campos reais (ex.: id_licitacao ou similar)
  titulo: bid.objeto || 'Não informado',
  orgao: bid.uasg_nome || bid.orgao || 'Não informado',
  modalidade: bid.modalidade_descricao || 'Não informada',
  data_publicacao: bid.data_publicacao || bid.dataPublicacao,
  link_oficial: bid._links?.self?.href || `https://compras.dados.gov.br/licitacoes/doc/licitacao/${bid.id}.html`,
  status: bid.situacao || 'Não informado',
  fonte: 'Compras.gov.br',
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
    const pageSize = 10;  // Simula 10 por página (API retorna até 500)
    const offset = (parseInt(page as string) - 1) * pageSize;

    const params = new URLSearchParams();
    
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 90);
    
    params.append('data_publicacao_min', getYYYYMMDD(pastDate));
    params.append('data_publicacao_max', getYYYYMMDD(today));
    
    params.append('offset', offset.toString());

    if (modality && typeof modality === 'string' && modality !== 'all') {
      const modalityCode = modalityMapping[modality] || modality;
      params.append('modalidade', modalityCode);
    }

    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('uf_uasg', uf.toUpperCase().trim());
    }
    
    if (city && typeof city === 'string' && city !== 'all' && /^\d{7}$/.test(city)) {
      params.append('uasg_municipio', city);
    }

    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      params.append('objeto', keyword.trim());
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
    let resultsData = rawData._embedded?.licitacoes || [];  // Estrutura HAL/HATEOAS típica

    // Slice para simular pageSize=10
    resultsData = resultsData.slice(0, pageSize);

    const mappedData = resultsData.map(mapBidData);

    // Estima total (se resposta tem <500, assume total = offset + len; caso contrário, indefinido ou requer mais calls)
    const fetchedCount = rawData._embedded?.licitacoes?.length || 0;
    const estimatedTotal = fetchedCount < 500 ? offset + fetchedCount : undefined;  // Se indefinido, frontend pode tratar como 'mais de X'
    const totalPagesForFrontend = estimatedTotal ? Math.ceil(estimatedTotal / pageSize) : undefined;

    return res.status(200).json({
      data: mappedData,
      total: estimatedTotal || fetchedCount,  // Use fetched como fallback
      totalPages: totalPagesForFrontend || 1,
    });

  } catch (error: any) {
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
