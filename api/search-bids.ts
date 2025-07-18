import type { VercelRequest, VercelResponse } from '@vercel/node';

// Endpoint para propostas abertas
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
  dispensa_de_licitacao: '8', // Para matcher nomes completos
  inexigibilidade: '9',
  manifestacao_interesse: '10',
  pre_qualificacao: '11',
  credenciamento: '12',
};

// Lista de siglas válidas de UF para validação (baseado no IBGE)
const validUFs = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

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
    const { keyword, modality, uf, city, page = '1', cityName } = req.query;

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
    params.append('tamanhoPagina', '10'); // De 10 em 10, como solicitado

    // Data final: hoje + 30 dias (sem dataInicial, não suportado)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    params.append('dataFinal', getYYYYMMDD(futureDate));

    // Modalidade: Use diretamente o código enviado do frontend
    const modValue = typeof modality === 'string' && modality !== 'all' ? modality : '6'; // Fallback for 'all'
    params.append('codigoModalidadeContratacao', modValue);

    // UF: Extraia apenas a sigla de 2 letras e valide
    let normalizedUf = typeof uf === 'string' && uf !== 'all' ? uf.toUpperCase().trim().split(' ')[0].slice(0, 2) : null;
    if (normalizedUf && validUFs.includes(normalizedUf)) {
      params.append('uf', normalizedUf);
    } else if (uf && uf !== 'all') {
      return res.status(400).json({ error: 'Sigla de UF inválida. Use apenas 2 letras maiúsculas (ex.: SP).' });
    }

    if (city && typeof city === 'string' && city !== 'all') {
      // Valide se código IBGE é 7 dígitos numéricos
      if (/^\d{7}$/.test(city)) {
        params.append('codigoMunicipiolbge', city);
      } else {
        return res.status(400).json({ error: 'Código IBGE da cidade inválido (deve ser 7 dígitos numéricos).' });
      }
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

    // Filtro manual para cidade se cityName enviado (envie o label 'Jacareí' do frontend como cityName)
    if (cityName && typeof cityName === 'string' && cityName !== 'all') {
      const lowerCityName = cityName.toLowerCase();
      filteredData = filteredData.filter((bid: any) => bid.unidadeOrgao.municipioNome?.toLowerCase().includes(lowerCityName)); // Use includes para match partial
    }

    // Filtre por keyword no lado do servidor (já que API não suporta)
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
      totalPages: Math.ceil(filteredData.length / 10) // Ajuste com tamanhoPagina
    });

  } catch (error: any) {
    console.error("Erro interno na função Vercel:", error.message, error.stack); // Mais logging para depuração
    return res.status(500).json({ error: error.message || 'Erro interno no servidor' });
  }
}
