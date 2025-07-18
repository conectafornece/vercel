import type { VercelRequest, VercelResponse } from '@vercel/node';

// Endpoint for open proposals (use this; switch to 'publicacao' for published bids if needed)
const PNCP_BASE_URL = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta";

// Atualize modalityMapping com todas:
const modalityMapping: { [key: string]: string } = {
  pregao_eletronico: '6',
  pregao_presencial: '7',
  concorrencia_eletronica: '4',
  concorrencia_presencial: '5',
  concurso: '3',
  leilao_eletronico: '1',
  leilao_presencial: '13',
  dialogo_competitivo: '2',
  dispensa: '8',
  inexigibilidade: '9',
  manifestacao_interesse: '10',
  pre_qualificacao: '11',
  credenciamento: '12',
};

// Na handler:
// Se modality === 'all', omita ou fallback
if (modality && typeof modality === 'string' && modality !== 'all' && modalityMapping[modality]) {
  params.append('codigoModalidadeContratacao', modalityMapping[modality]);
} else if (modality === 'all') {
  // Omita: params.append('codigoModalidadeContratacao', ''); // Teste se API permite
  // OU fallback: params.append('codigoModalidadeContratacao', '6'); // Pregão Eletrônico como default
} else {
  return res.status(400).json({ error: 'Modalidade inválida ou não informada (obrigatória).' });
}

// Mapeia os dados da API para o formato esperado
const mapBidData = (pncpBid: any) => ({
  id_unico: pncpBid.numeroControlePNCP || pncpBid.numeroCompra,
  titulo: pncpBid.objetoCompra,
  orgao: pncpBid.orgaoEntidade?.razaoSocial || 'Não informado',
  modalidade: pncpBid.modalidadeNome || 'Não informada',
  data_publicacao: pncpBid.dataPublicacaoPncp,
  link_oficial: `https://pncp.gov.br/app/editais?numeroControle=${pncpBid.numeroControlePNCP}`,
  status: pncpBid.situacaoCompraNome || 'Não informado',
  fonte: 'PNCP',
});

function getYYYYMMDD(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { keyword, modality, uf, city, page = '1' } = req.query;

    // Exija pelo menos um filtro válido (exceto keyword, que filtramos manualmente)
    if (
      (!modality || modality === 'all') &&
      (!uf || uf === 'all') &&
      (!city || city === 'all') &&
      (!keyword || keyword === '')
    ) {
      return res.status(400).json({ error: 'Pelo menos um filtro (modalidade, UF, cidade ou palavra-chave) deve ser preenchido.' });
    }

    const params = new URLSearchParams();
    params.append('pagina', Array.isArray(page) ? page[0] : page);
    params.append('tamanhoPagina', '50'); // Aumente para 50 (máx 500) para mais dados por chamada; equilibre com performance

    // Data final: hoje + 30 dias para capturar propostas abertas futuras
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    params.append('dataFinal', getYYYYMMDD(futureDate));

    // Modalidade é obrigatória; se 'all', omita (teste se API permite; senão, defina default)
    if (modality && typeof modality === 'string' && modality !== 'all' && modalityMapping[modality]) {
      params.append('codigoModalidadeContratacao', modalityMapping[modality]);
    } else if (modality === 'all') {
      // Omita; se API erro, defina um default como '6' (Pregão Eletrônico, comum)
      params.append('codigoModalidadeContratacao', '6'); // Default fallback
    } else {
      return res.status(400).json({ error: 'Modalidade inválida ou não informada (obrigatória).' });
    }

    if (uf && typeof uf === 'string' && uf !== 'all') {
      params.append('uf', uf.toUpperCase());
    }
    if (city && typeof city === 'string' && city !== 'all') {
      params.append('codigoMunicipiolbge', city); // Deve ser código IBGE numérico
    }

    const url = `${PNCP_BASE_URL}?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API PNCP: ${response.status} - ${url}`, errorText);
      return res.status(response.status).json({ error: `Erro na API PNCP: ${errorText}` });
    }

    const rawData = await response.json();
    let filteredData = rawData.data || [];

    // Filtre por keyword server-side (já que API não suporta)
    if (keyword && typeof keyword === 'string' && keyword.trim() !== '') {
      const lowerKeyword = keyword.toLowerCase();
      filteredData = filteredData.filter((bid: any) =>
        (bid.objetoCompra?.toLowerCase().includes(lowerKeyword) ||
         bid.informacaoComplementar?.toLowerCase().includes(lowerKeyword))
      );
    }

    // Mapeie os resultados filtrados
    const mappedData = filteredData.map(mapBidData);

    return res.status(200).json({
      data: mappedData,
      total: filteredData.length, // Use o total filtrado (não o da API, pois filtramos)
      totalPages: Math.ceil(filteredData.length / 50) // Ajuste com tamanhoPagina
    });

  } catch (error: any) {
    console.error("Erro interno:", error);
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
