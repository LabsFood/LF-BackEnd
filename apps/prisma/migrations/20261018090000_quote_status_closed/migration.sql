-- A request Lab's Food closes without follow-up: distinct from the client's
-- refusal ('declined') and withdrawal ('cancelled').

-- AlterEnum
ALTER TYPE "quote_status" ADD VALUE 'closed';
