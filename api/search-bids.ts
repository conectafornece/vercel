import type { VercelRequest, VercelResponse } from '@vercel/node';

// O endpoint correto para consulta de publicações.
const PNCP_BASE_URL = "https://pncp.gov.br/pncp-consulta/v1/contratacoes/publicacao";

// Mapeamento de modalidades para os códigos numéricos que a API do PNCP exige.
const modalityMapping: { [key: string]: string } = {
  pregao_eletronico: '6',
  pregao_presencial: '7',
  concorrencia_eletronica: '4',
  concorrencia_presencial: '5',
  concurso: '3',
  leilao: '1', // Leilão eletrónico, o mais comum
  dialogo_competitivo: '2',
  dispensa_de_licitacao: '8',
  inexigibilidade: '9',
  credenciamento: '12',
};

// Mapeia os dados da API do PNCP para o formato que o seu frontend espera.
const mapBidData = (pncpBid: any) => ({
  id_unico: pncpBid.numeroControlePNCP,
  titulo: pncpBid.objetoCompra,
  orgao: pncpBid.orgaoEntidade?.razaoSocial || 'Não informado',
  modalidade: pncpBid.modalidadeNome || 'Não informada',
  data_publicacao: pncpBid.dataPublicacaoPncp,
  link_oficial: `https://pncp.gov.br/app/contratacoes/${pncpBid.numeroControlePNCP}`,
  status: pncpBid.situacaoCompraNome || 'Não informado',
  fonte: 'PNCP',
});

// Função auxiliar para formatar datas no padrão YYYYMMDD.
function getYYYYMMDD(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Configurações de CORS para permitir acesso do seu frontend.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { modality, uf, city, page = '1' } = req.query;

    const params = new URLSearchParams();
    
    params.append('pagina', Array.isArray(page) ? page[0] : page);
    params.append('tamanhoPagina', '10');

    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 90);
    params.append('dataInicial', getYYYYMMDD(pastDate));
    params.append('dataFinal', getYYYYMMDD(today));

    let modalityCode = '6'; 
    if (modality && typeof modality === 'string' && modality !== 'all') {
      modalityCode = modalityMapping[modality] || modality;
    }
    params.append('codigoModalidadeContratacao', modalityCode);

    // LÓGICA DE FILTRO FINAL E CORRETA:
    // Enviamos todos os filtros disponíveis diretamente para a API do PNCP.
    if (uf && typeof uf === 'string' && uf !== 'all') {
        params.append('uf', uf.toUpperCase().trim());
    }
    
    if (city && typeof city === 'string' && /^\d{7}$/.test(city)) {
        params.append('codigoMunicipiolbge', city);
    }
    
    const url = `${PNCP_BASE_URL}?${params.toString()}`;
    console.log(`Fetching PNCP API with URL: ${url}`);
    
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API PNCP: ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `Erro na API PNCP: ${errorText}` });
    }

    const rawData = await response.json();
    
    // A API do PNCP agora faz toda a filtragem.
    const mappedData = (rawData.data || []).map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: rawData.totalRegistros || 0,
      totalPages: rawData.totalPaginas || 0,
    });

  } catch (error: any) {
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
