export interface OrgaoCompras {
 nomeOrgaoEntidade: string;
 nomeUnidadeOrgao: string;
 cidade: string;
 uf: string;
}

export interface DocumentoCompras {
 filename: string;
 url: string;
}

export interface ComprasLicitacao {
 idCompra: string;
 numeroControlePNCP: string;
 anoCompraPncp: number;
 sequencialCompraPncp: number;
 orgaoEntidadeCnpj: string;
 orgaoEntidadeRazaoSocial: string;
 unidadeOrgaoCodigoUnidade: string;
 unidadeOrgaoNomeUnidade: string;
 unidadeOrgaoUfSigla: string;
 unidadeOrgaoMunicipioNome: string;
 numeroCompra: string;
 modalidadeIdPncp: number;
 modalidadeNome: string;
 objetoCompra: string;
 situacaoCompraNomePncp: string;
 valorTotalEstimado?: number;
 valorTotalHomologado?: number;
 dataPublicacaoPncp: string;
 dataAberturaPropostaPncp?: string;
 dataEncerramentoPropostaPncp?: string;
 processo?: string;
 informacaoComplementar?: string;
}

// Nova interface para detalhes do Contrato baseada no exemplo do PDF e documentação da API
export interface ComprasContrato {
 idContrato: string;
 uasg: number;
 numeroProcesso: string;
 fornecedor: {
  cnpj: string;
  nome: string;
 };
 valorTotalContratado: number;
 dataAssinatura: string;
 dataHoraAtualizacao: string;
}

export interface ApiResponse<T = unknown> {
 success: boolean;
 data?: T;
 error?: string;
 status?: number;
}

export interface ComprasApiResponse {
 resultado: ComprasLicitacao[];
 totalRegistros: number;
 totalPaginas: number;
 paginasRestantes: number;
}