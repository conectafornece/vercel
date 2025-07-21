import type { VercelRequest, VercelResponse } from '@vercel/node';

// ===================================================================
// INÍCIO DA ALTERAÇÃO FINAL: Apontando para o endpoint correto
// ===================================================================
const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';
// ===================================================================
// FIM DA ALTERAÇÃO FINAL
// ===================================================================

const mapBidData = (contratacao: any) => ({
  id_unico: contratacao.id,
  titulo: contratacao.objetoCompra || 'Objeto não informado',
  orgao: contratacao.orgaoEntidade ? contratacao.orgaoEntidade.razaoSocial : 'Órgão não informado',
  modalidade: contratacao.modalidadeNome || (contratacao.modalidade ? contratacao.modalidade.nome : 'Modalidade não informada'),
  data_publicacao: contratacao.dataPublicacaoPncp,
  link_oficial: `https://www.gov.br/pncp/pt-br/contrato/-/contratos/${contratacao.numeroControlePNCP}`,
  status: contratacao.situacaoCompraNome || (contratacao.situacao ? contratacao.situacao.nome : 'Situação não informada'),
  municipio: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.municipioNome : 'Município não informado',
  municipio_codigo_ibge: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.codigoIbge : null,
  uf: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.ufSigla : 'UF não informada',
  fonte: 'PNCP (Consulta Ativa)',
});

function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
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
    const params = new URLSearchParams();
    
    // Para o endpoint /proposta, a data inicial não é obrigatória.
    // Vamos buscar propostas com data final para os próximos 60 dias para ampliar os resultados.
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + 60);
    
    // params.append('dataInicial', formatDateToYYYYMMDD(today)); // Opcional
    params.append('dataFinal', formatDateToYYYYMMDD(futureDate));

    params.append('pagina', page as string);
    params.append('tamanhoPagina', '10');

    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      params.append('termoBusca', keyword.trim());
    }

    if (modality && typeof modality === 'string' && modality !== 'all') {
      const modalityCodes = modality.split(',');
      modalityCodes.forEach(code => {
        params.append('codigoModalidadeContratacao', code);
      });
    }

    if (city && city !== 'all') {
      params.append('codigoMunicipioIbge', city as string);
    } else if (uf && uf !== 'all') {
      params.append('uf', uf as string);
    }

    const url = `${PNCP_API_BASE_URL}?${params.toString()}`;
    console.log(`Buscando no endpoint /proposta: ${url}`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API do PNCP: ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `A API do PNCP retornou um erro. Detalhes: ${errorText}` });
    }

    const rawData = await response.json();
    const resultsData = rawData.data || [];
    const mappedData = resultsData.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: rawData.totalRegistros, // O endpoint /proposta usa 'totalRegistros'
      totalPages: rawData.totalPaginas,
    });

  } catch (error: any) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error("Timeout na API PNCP ou na função Vercel");
      return res.status(504).json({ error: 'A busca demorou demais para responder (Timeout). Tente ser mais específico com os filtros.' });
    }
    console.error("Erro interno na função Vercel:", error.message);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
