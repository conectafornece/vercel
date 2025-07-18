import type { VercelRequest, VercelResponse } from '@vercel/node';

// URL base da API Compras.gov.br para contratos (dados a partir de 2021)
const API_BASE_URL = "https://compras.dados.gov.br/contratos/v1/contratos.json";

// Mapeamento de modalidades (códigos da API Compras.gov.br para modalidade_licitacao)
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
    
    params.append('data_assinatura_min', getYYYYMMDD(pastDate));
    params.append('data_assinatura_max', getYYYYMMDD(today));
    
    params.append('offset', offset.toString());

    if (modality && typeof modality === 'string' && modality !== 'all') {
      const modalityCode = modalityMapping[modality] || modality;
      params.append('modalidade_licitacao', modalityCode);
    }

    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('uf_orgao', uf.toUpperCase().trim());
    }
    
    if (city && typeof city === 'string' && city !== 'all' && /^\d{7}$/.test(city)) {
      params.append('municipio_orgao', city);
    }

    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      params.append('objeto_contrato', keyword.trim());
    }
    
    const url = `${API_BASE_URL}?${params.toString()}`;
    console.log(`Fetching Compras.gov.br API with URL: ${url}`);
    
    // Adiciona timeout de 30 segundos no fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API Compras.gov.br: ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `Erro na API Compras.gov.br: ${errorText}` });
    }

    const rawData = await response.json();
    let resultsData = rawData._embedded?.contratos || [];  // Estrutura HAL/HATEOAS típica para contratos

    // Slice para simular pageSize=10
    resultsData = resultsData.slice(0, pageSize);

    const mappedData = resultsData.map(mapBidData);

    // Estima total (se <500, assume total = offset + len; caso contrário, indefinido)
    const fetchedCount = rawData._embedded?.contratos?.length || 0;
    const estimatedTotal = fetchedCount < 500 ? offset + fetchedCount : undefined;
    const totalPagesForFrontend = estimatedTotal ? Math.ceil(estimatedTotal / pageSize) : undefined;

    return res.status(200).json({
      data: mappedData,
      total: estimatedTotal || fetchedCount,
      totalPages: totalPagesForFrontend || 1,
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
