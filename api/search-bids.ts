import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_BASE_URL = "https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133";

const mapBidData = (contratacao: any) => ({
  id_unico: contratacao.idCompra,
  titulo: contratacao.objetoCompra,
  orgao: contratacao.orgaoEntidadeRazaoSocial,
  modalidade: contratacao.modalidadeNome,
  data_publicacao: contratacao.dataPublicacaoPncp,
  link_oficial: `https://www.gov.br/pncp/pt-br/contrato/-/contratos/${contratacao.numeroControlePNCP}`,
  status: contratacao.situacaoCompraNomePncp,
  municipio: contratacao.unidadeOrgaoMunicipioNome,
  municipio_codigo_ibge: contratacao.unidadeOrgaoCodigolbge,
  uf: contratacao.unidadeOrgaoUfSigla,
  fonte: 'Compras.gov.br (PNCP)',
});

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
    const { modality, uf, city, page = '1' } = req.query; // Removido 'keyword' pois não é usado

    const params = new URLSearchParams();
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 30);

    params.append('dataPublicacaoPncpInicial', getYYYYMMDD(pastDate));
    params.append('dataPublicacaoPncpFinal', getYYYYMMDD(today));
    
    if (page) params.append('pagina', page as string);
    
    // --- LÓGICA DE MODALIDADE ATUALIZADA ---
    // Se a modalidade for 'all', o parâmetro 'codigoModalidade' simplesmente não será adicionado à URL.
    if (modality && modality !== 'all') {
        params.append('codigoModalidade', modality as string);
    }
    
    // --- LÓGICA DE LOCALIZAÇÃO (JÁ CORRIGIDA) ---
    if (city && city !== 'all') {
        params.append('unidadeOrgaoCodigoIbge', city as string);
    } else if (uf && uf !== 'all') {
        params.append('unidadeOrgaoUfSigla', uf as string);
    }
    
    const url = `${API_BASE_URL}?${params.toString()}`;
    console.log(`Buscando na API PNCP com a URL: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API Compras.gov.br (HTTP Status não OK): ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `A API de Contratações retornou um erro. Detalhes: ${errorText}` });
    }

    let rawData;
    try {
        rawData = await response.json();
    } catch (e) {
        console.error("Falha ao analisar a resposta da API como JSON. A API pode estar offline ou retornando uma página de erro em HTML.", e);
        return res.status(502).json({ error: 'A API do governo retornou uma resposta inválida (não-JSON). O serviço pode estar temporariamente indisponível.' });
    }

    const resultsData = rawData.resultado || [];
    
    const total = rawData.totalRegistros || resultsData.length;
    const totalPages = rawData.totalPaginas || Math.ceil(total / 10);

    const mappedData = resultsData.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: total,
      totalPages: totalPages > 0 ? totalPages : 1,
    });

  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error("Timeout na API Compras.gov.br (Contratações)");
      return res.status(504).json({ error: 'Timeout na requisição à API. Tente novamente ou ajuste os filtros.' });
    }
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
