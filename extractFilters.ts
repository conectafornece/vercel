// src/utils/extractFilters.ts
import { GoogleGenerativeAI, GoogleGenerativeAIError } from '@google/generative-ai';
import { format } from 'date-fns';

// Garante que a chave seja verificada corretamente no nível do módulo
if (!process.env.GOOGLE_API_KEY) {
  console.error("❌ FATAL: GOOGLE_API_KEY não está definida nas variáveis de ambiente.");
  throw new Error('GOOGLE_API_KEY não está definida nas variáveis de ambiente');
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Interface atualizada para incluir datas
export interface ExtractedFilters {
  palavrasChave: string[];
  sinonimos: string[][];
  valorMin: number | null;
  valorMax: number | null;
  estado: string | null;
  modalidade: string | null;
  dataInicial: string | null; // Formato YYYY-MM-DD
  dataFinal: string | null;   // Formato YYYY-MM-DD
}

/**
 * Extrai filtros estruturados de uma pergunta em linguagem natural usando a API Gemini.
 * @param question A pergunta do usuário sobre licitações.
 * @returns Uma promessa que resolve para um objeto ExtractedFilters.
 */
export async function extractFilters(question: string): Promise<ExtractedFilters> {
  const defaultResponse: ExtractedFilters = {
    palavrasChave: [],
    sinonimos: [],
    valorMin: null,
    valorMax: null,
    estado: null,
    modalidade: null,
    dataInicial: null,
    dataFinal: null,
  };

  if (!question || typeof question !== 'string' || !question.trim()) {
    console.warn("⚠️ extractFilters chamada com pergunta inválida.");
    return defaultResponse;
  }
  console.log(`🧠 Chamando Gemini para extrair filtros de: "${question}"`);

  const hoje = new Date();
  const dataAtualFormatada = format(hoje, 'yyyy-MM-dd');

  // --- PROMPT OTIMIZADO ---
  // 1. Adicionada regra explícita para "últimos X dias".
  const prompt = `
<MISSION>
Você é um assistente de IA altamente especializado, focado em analisar perguntas sobre licitações públicas no Brasil. Sua única função é extrair informações da pergunta do usuário e convertê-las em um objeto JSON estrito, sem qualquer texto, explicação ou markdown adicional.
</MISSION>

<CONTEXT>
A data de referência (hoje) é: ${dataAtualFormatada}.

A seguir estão os ramos de atuação da empresa. Use esta lista como sua base de conhecimento principal para mapear os termos da pergunta do usuário.

1.  **Alimentação Prisional:**
    * **Termos-chave**: "alimentação prisional", "refeições para presídios", "fornecimento de alimentação para unidades prisionais", "nutrição prisional".
    * **Sinônimos**: "alimentação para detentos", "gestão de refeitório prisional", "kit lanche para sistema prisional", "refeições transportadas para presídios".

2.  **Alimentação Hospitalar:**
    * **Termos-chave**: "alimentação hospitalar", "refeições para hospitais", "serviços de nutrição hospitalar", "dieta hospitalar".
    * **Sinônimos**: "gestão de refeitório hospitalar", "nutrição clínica", "alimentação enteral", "fornecimento de dietas para pacientes".

3.  **Merenda ou Alimentação Escolar:**
    * **Termos-chave**: "merenda escolar", "alimentação escolar", "refeições para escolas", "PNAE", "programa nacional de alimentação escolar".
    * **Sinônimos**: "fornecimento de merenda", "gestão de cantina escolar", "refeitório escolar", "kit merenda".

4.  **Frota com Motorista:**
    * **Termos-chave**: "locação de frota com motorista", "aluguel de veículos com condutor", "transporte executivo", "terceirização de frota".
    * **Sinônimos**: "serviços de motorista", "transporte de passageiros", "veículos com motorista à disposição", "fretamento de veículos".

5.  **Cogestão Prisional:**
    * **Termos-chave**: "cogestão prisional", "gestão compartilhada de unidade prisional", "administração prisional".
    * **Sinônimos**: "parceria na gestão de presídios", "gestão de estabelecimentos penais", "apoio à gestão prisional".

6.  **Fornecimento de Mão de Obra (Facilities):**
    * **Termos-chave**: "fornecimento de mão de obra", "terceirização de serviços", "mão de obra dedicada", "postos de trabalho".
    * **Sinônimos**: "facilities", "apoio administrativo", "recepcionista", "porteiro", "copeiragem", "serviços gerais".

7.  **Limpeza (Predial, Escolar e Hospitalar):**
    * **Limpeza Predial**: "limpeza predial", "conservação e limpeza", "higienização de edifícios", "limpeza de fachadas", "tratamento de piso".
    * **Limpeza Escolar**: "limpeza escolar", "higienização de escolas", "conservação de ambiente escolar".
    * **Limpeza Hospitalar**: "limpeza hospitalar", "higienização hospitalar", "limpeza e desinfecção hospitalar", "limpeza terminal", "assepsia de ambientes", "gestão de resíduos de saúde".

8.  **PPP e Concessões:**
    * **Termos-chave**: "ppp", "parceria público-privada", "concessão administrativa", "concessão patrocinada", "ppi", "pmi".
    * **Sinônimos**: "edital de manifestação de interesse", "procedimento de manifestação de interesse".

9.  **Engenharia (Construção, Reforma, Manutenção):**
    * **Termos-chave**: "engenharia", "construção civil", "reforma predial", "manutenção predial", "obras".
    * **Sinônimos**: "serviços de engenharia", "edificações", "infraestrutura predial", "manutenção preventiva", "manutenção corretiva".
</CONTEXT>

<RULES>
1.  **Mapeamento de Termos**: Identifique os ramos de atuação na pergunta do usuário. Popule 'palavrasChave' com os termos exatos da pergunta e os "Termos-chave" dos ramos correspondentes. Popule 'sinonimos' com os "Sinônimos" dos ramos. Se múltiplos ramos forem identificados, combine seus termos e sinônimos.

2.  **Extração de Datas**:
    * A data de hoje é ${dataAtualFormatada}. Use sempre o formato YYYY-MM-DD.
    * "últimos X dias": dataFinal é hoje, dataInicial é hoje - X dias.
    * "hoje": dataInicial e dataFinal são ${dataAtualFormatada}.
    * Se um período explícito for dado (ex: "de 01/07/2025 a 15/07/2025"), use-o.
    * Se nenhum período for mencionado, 'dataInicial' e 'dataFinal' devem ser null.

3.  **Extração de Valores**:
    * Interprete valores como "1 milhão" (1000000), "500 mil" (500000).
    * "acima de X" ou "a partir de X": preencha 'valorMin'.
    * "abaixo de X" ou "até X": preencha 'valorMax'.
    * "entre X e Y": preencha 'valorMin' e 'valorMax'.

4.  **Extração de Estado**:
    * Identifique o estado brasileiro mencionado. Retorne a sigla em maiúsculas (ex: "São Paulo" -> "SP", "Rio" -> "RJ"). Se não houver menção, retorne null.

5.  **Extração de Modalidade**:
    * Identifique modalidades de licitação como "Pregão Eletrônico", "Pregão Presencial", "Concorrência", "Tomada de Preços", "Convite", "Leilão", "Concurso". Se não houver menção, retorne null.
</RULES>

<OUTPUT_FORMAT>
Sua única saída deve ser um objeto JSON válido, aderindo estritamente à seguinte estrutura. Não inclua texto ou markdown antes ou depois do JSON.

{
  "palavrasChave": ["string"],
  "sinonimos": [["string"]],
  "valorMin": number | null,
  "valorMax": number | null,
  "estado": string | null,
  "modalidade": string | null,
  "dataInicial": string | null,
  "dataFinal": string | null
}
</OUTPUT_FORMAT>

<PROCESS_AND_EXAMPLES>
Analise a pergunta do usuário e siga as regras para gerar o JSON.

**Exemplo 1 (Cenário: hoje é 2025-06-11)**
Pergunta: "Pregão eletrônico para limpeza hospitalar e também merenda para escolas no estado de SP dos últimos 7 dias, acima de 1 milhão"
JSON de Saída:
{
  "palavrasChave": ["pregão eletrônico", "limpeza hospitalar", "merenda escolar", "alimentação escolar"],
  "sinonimos": [["higienização hospitalar", "desinfecção hospitalar"], ["fornecimento de merenda", "pnae"]],
  "valorMin": 1000000,
  "valorMax": null,
  "estado": "SP",
  "modalidade": "Pregão Eletrônico",
  "dataInicial": "2025-06-04",
  "dataFinal": "2025-06-11"
}

**Exemplo 2**
Pergunta: "obras de engenharia no Rio de Janeiro"
JSON de Saída:
{
  "palavrasChave": ["obras de engenharia", "construção civil", "reforma predial", "manutenção predial"],
  "sinonimos": [["edificações", "infraestrutura predial"]],
  "valorMin": null,
  "valorMax": null,
  "estado": "RJ",
  "modalidade": null,
  "dataInicial": null,
  "dataFinal": null
}
</PROCESS_AND_EXAMPLES>

---
Agora, analise a pergunta abaixo e retorne APENAS o objeto JSON correspondente.
Pergunta do Usuário: "${question}"
`;
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    if (!text) throw new Error('Falha ao extrair filtros: resposta da IA vazia');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Resposta da IA não parece conter um objeto JSON válido.');

    const jsonText = jsonMatch[0];
    const parsedResponse = JSON.parse(jsonText) as Partial<ExtractedFilters>;
    const validatedResponse: ExtractedFilters = { ...defaultResponse };

    if (Array.isArray(parsedResponse.palavrasChave)) validatedResponse.palavrasChave = parsedResponse.palavrasChave.filter(kw => typeof kw === 'string');
    if (Array.isArray(parsedResponse.sinonimos)) validatedResponse.sinonimos = parsedResponse.sinonimos.map(s => Array.isArray(s) ? s.filter(i => typeof i === 'string') : []);
    if (typeof parsedResponse.valorMin === 'number') validatedResponse.valorMin = parsedResponse.valorMin;
    if (typeof parsedResponse.valorMax === 'number') validatedResponse.valorMax = parsedResponse.valorMax;
    if (typeof parsedResponse.estado === 'string') validatedResponse.estado = parsedResponse.estado.toUpperCase().trim();
    if (typeof parsedResponse.modalidade === 'string') validatedResponse.modalidade = parsedResponse.modalidade.trim();
    if (typeof parsedResponse.dataInicial === 'string') validatedResponse.dataInicial = parsedResponse.dataInicial;
    if (typeof parsedResponse.dataFinal === 'string') validatedResponse.dataFinal = parsedResponse.dataFinal;

    console.log("✅ Filtros extraídos e validados:", validatedResponse);
    return validatedResponse;

  } catch (error: unknown) {
    console.error('❌ Erro em extractFilters:', error);
    if (error instanceof GoogleGenerativeAIError) {
      throw new Error(`Falha na comunicação com a IA Gemini: ${error.message}`);
    }
    throw error;
  }
}
