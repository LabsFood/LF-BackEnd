-- The signed SEPA commission mandate is filed in the chef's dossier, beside the KYC
-- documents. The API writes it itself once Stripe confirms the signature; a chef can
-- read it but never upload one.

-- AlterEnum
ALTER TYPE "chef_document_type" ADD VALUE 'sepa_mandate';
