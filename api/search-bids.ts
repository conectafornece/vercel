import type { VercelRequest, VercelResponse } from '@vercel/node';

// 1. VOLTAMOS PARA O ENDPOINT DE LICITAÇÕES, QUE SUPORTA OS FILTROS CORRETAMENTE
const PNCP_BASE_URL = "https://pncp.gov.br/pncp-consulta/v1/licitacoes";

// Lista de siglas de UF válidas para validação
const validUFs = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

// Mapeia os dados da API para o formato que seu frontend espera
const mapBidData = (pncpBid: any) => ({
  id_unico: pncpBid.numeroControlePNCP || pncpBid.numeroCompra,
  titulo: pncpBid.objetoCompra,
  orgao: pncpBid.orgaoEntidade?.razaoSocial || 'Não informado',
  modalidade: pncpBid.modalidade?.nome || 'Não informada',
  data_publicacao: pncpBid.dataPublicacaoPncp,
  // Link correto para o detalhe da licitação/edital
  link_oficial: `https://pncp.gov.br/app/editais/${pncpBid.id}/detalhe`,
  status: pncpBid.situacaoCompra?.nome || 'Não informado',
  fonte: 'PNCP',
});

// Função para formatar data para YYYYMMDD
function getYYYYMMDD(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
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
    const { keyword, modality, uf, city, page = '1' } = req.query;

    const params = new URLSearchParams();
    
    // 2. RE-ADICIONAMOS O TAMANHO DA PÁGINA, CORRIGINDO O ERRO
    params.append('pagina', Array.isArray(page) ? page[0] : page);
    params.append('tamanhoPagina', '10');

    // Define um período de busca padrão (últimos 90 dias)
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 90);
    params.append('dataInicial', getYYYYMMDD(pastDate));
    params.append('dataFinal', getYYYYMMDD(today));

    // 3. AGORA A API FILTRA A PALAVRA-CHAVE DIRETAMENTE (MAIS EFICIENTE)
    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      params.append('palavraChave', keyword);
    }

    // Filtro de Modalidade (se enviado)
    if (modality && typeof modality === 'string' && modality !== 'all') {
        // A API de licitações parece aceitar o nome direto, não o código
        params.append('modalidade', modality);
    }

    // Filtro de UF (com validação)
    if (uf && typeof uf === 'string' && uf !== 'all') {
      const normalizedUf = uf.toUpperCase().trim();
      if (validUFs.includes(normalizedUf)) {
        params.append('uf', normalizedUf);
      }
    }
    
    // Filtro de Município (código IBGE)
    if (city && typeof city === 'string' && city !== 'all') {
      if (/^\d{7}$/.test(city)) {
        params.append('codigoMunicipio', city);
      }
    }

    const url = `${PNCP_BASE_URL}?${params.toString()}`;
    
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API PNCP: ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `Erro na API PNCP: ${errorText}` });
    }

    const rawData = await response.json();
    
    // 4. NÃO PRECISAMOS MAIS FILTRAR MANUALMENTE, A API JÁ FEZ O TRABALHO
    const mappedData = (rawData.data || []).map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: rawData.total, // Usamos o total que a API nos dá
      totalPages: rawData.totalPaginas,
    });

  } catch (error: any) {
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
