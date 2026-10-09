export type RhCatalogItemKind = "app" | "workflow";
export type RhSlotDataType = "text" | "image" | "video" | "audio" | "json";
export type RhSlotCardinality = "single" | "multiple";
export type RhTaskCapability = "image" | "video" | "audio" | "chat";

export interface RhSlotBindingTarget {
  nodeId: string;
  fieldName: string;
  path: string;
}

export interface RhInputSlotDefinition {
  key: string;
  name: string;
  title: string;
  description: string;
  dataType: RhSlotDataType;
  cardinality: RhSlotCardinality;
  required: boolean;
  supportsConnection: boolean;
  supportsManualInput: boolean;
  supportsUpload: boolean;
  bindingTarget: RhSlotBindingTarget;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  manualValue?: string | number | boolean;
  options?: Array<string | number>;
}

export interface RhFieldDefinition {
  nodeId?: string;
  fieldName?: string;
  label?: string;
  displayLabel?: string;
  description?: string;
  fieldType?: string;
  valueType?: string;
  placeholder?: string;
  required?: boolean;
  fieldValue?: string | number | boolean;
  defaultValue?: string | number | boolean;
  options?: Array<string | number>;
}

export interface RhCatalogSource {
  catalogId?: string;
  kind?: RhCatalogItemKind;
  title?: string;
  providerId?: string;
  pageId?: string;
  appId?: string;
  workflowId?: string;
  runTargetId?: string;
  taskCapability?: RhTaskCapability;
  allowsEmptyInputs?: boolean;
  fields?: RhFieldDefinition[];
}

export interface RhExecutionSubmitDescriptor {
  mode: "direct";
  targetType: RhCatalogItemKind;
  targetId: string;
  pageId?: string;
  appId?: string;
  workflowId?: string;
  taskCapability: RhTaskCapability;
  submitMode: "ai-app" | "openapi-v2-workflow";
  queryMode: "outputs" | "openapi-v2-query";
  endpoint: string;
  method: "POST";
}

export interface RhExecutionDescriptor {
  submit: RhExecutionSubmitDescriptor;
  assetHandling: {
    input: {
      acceptsUploads: boolean;
      acceptsRemoteUrls: boolean;
      requiresPreSignedUrls: boolean;
    };
    output: {
      resultKind: "remote-url";
      supportsMultiple: boolean;
    };
  };
  polling: {
    strategy: "none" | "fixed-interval";
    intervalMs: number;
    timeoutMs?: number;
  };
  result: {
    mode: "inline";
    payloadPath: string;
    errorPath: string;
  };
  errorHandling: {
    surface: "provider-message";
    retryable: boolean;
    messagePath: string;
  };
}

export interface RhCatalogItem {
  catalogId: string;
  kind: RhCatalogItemKind;
  title: string;
  enabled: boolean;
  providerId: string;
  inputSlots: RhInputSlotDefinition[];
  execution: RhExecutionDescriptor;
  pageId: string;
  appId: string;
  workflowId: string;
  runTargetId: string;
  taskCapability: RhTaskCapability;
  allowsEmptyInputs?: boolean;
  fields: RhFieldDefinition[];
}

export interface RunningHubKeyPoolItem {
  id: string;
  note: string;
  apiKey?: string;
  apiKeyPreview?: string;
  maxConcurrency: number;
  enabled: boolean;
  isDefault: boolean;
  currentInFlight?: number;
}
