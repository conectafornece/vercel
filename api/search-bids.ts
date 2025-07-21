import type { VercelRequest, VercelResponse } from '@vercel/node';

const PNCP_API_BASE_URL = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao';

const mapBidData = (contratacao: any) => ({
  id_unico: contratacao.id,
  titulo: contratacao.objeto || 'Objeto não informado',
  orgao: contratacao.orgaoEntidade ? contratacao.orgaoEntidade.razaoSocial : 'Órgão não informado',
  modalidade: contratacao.modalidade ? contratacao.modalidade.nome : 'Modalidade não informada',
  data_publicacao: contratacao.dataPublicacaoPncp,
  link_oficial: `https://www.gov.br/pncp/pt-br/contrato/-/contratos/${contratacao.numeroControlePncp}`,
  status: contratacao.situacao ? contratacao.situacao.nome : 'Situação não informada',
  municipio: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.municipioNome : 'Município não informado',
  municipio_codigo_ibge: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.codigoIbge : null,
  uf: contratacao.unidadeOrgao ? contratacao.unidadeOrgao.ufSigla : 'UF não informada',
  fonte: 'PNCP (Consulta)',
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
    
    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - 60);
    
    params.append('dataInicial', formatDateToYYYYMMDD(pastDate));
    params.append('dataFinal', formatDateToYYYYMMDD(today));
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

    // ===================================================================
    // INÍCIO DA ALTERAÇÃO: Voltando para a lógica 'if/else if' como teste
    // ===================================================================
    // Vamos enviar OU a cidade OU o estado, para ver se a API respeita o
    // filtro de cidade quando ele é enviado de forma isolada.
    if (city && city !== 'all') {
      params.append('codigoIbgeMunicipio', city as string);
    } else if (uf && uf !== 'all') {
      params.append('uf', uf as string);
    }
    // ===================================================================
    // FIM DA ALTERAÇÃO
    // ===================================================================

    const url = `${PNCP_API_BASE_URL}?${params.toString()}`;
    console.log(`Buscando na API (teste de isolamento): ${url}`);

    const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'Accept': 'application/json' } });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `A API do PNCP retornou um erro. Detalhes: ${errorText}` });
    }

    const rawData = await response.json();
    const mappedData = (rawData.data || []).map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: rawData.total,
      totalPages: rawData.totalPagina,
    });

  } catch (error: any) {
    // ... (bloco catch permanece o mesmo) ...
  }
}
