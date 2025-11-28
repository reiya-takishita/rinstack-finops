// 初回ログイン時に作成されるデフォルト組織の設定
export const DEFAULT_ORGANIZATION_CONFIG = {
  organizationName: "My Organization",
  organizationDescription: "デフォルト組織です",
  emailAddress: "",
  phoneNumber: "",
  postalCode: "",
  address1: "",
  address2: "",
  websiteUrl: "",
  attachmentFileId: null,
  isDefault: true
};

// 初回ログイン時に作成されるデフォルトプロジェクトの設定
export const DEFAULT_PROJECT_CONFIG = {
  projectName: "My First Project", 
  projectDescription: "デフォルトプロジェクトです",
  projectStatusCode: "0001", // ACTIVE
  isDefault: true
}; 