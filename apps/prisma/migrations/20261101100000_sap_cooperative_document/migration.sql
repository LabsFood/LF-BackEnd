-- A candidate with no SAP declaration of their own (type-b route) proves membership of
-- the cooperative that holds it. Lab's Food is not a cooperative: without one of the
-- two, nobody is onboarded.

-- AlterEnum
ALTER TYPE "chef_document_type" ADD VALUE 'sap_cooperative' AFTER 'sap_declaration';
