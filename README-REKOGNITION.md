# Amazon Rekognition setup

Set these Vercel Production environment variables before using AI matching:

- `AWS_REGION` — AWS region where the Rekognition collection will live (for example `ap-south-1`).
- `AWS_ACCESS_KEY_ID` — AWS access key for the server-side integration.
- `AWS_SECRET_ACCESS_KEY` — AWS secret access key.
- `AWS_REKOGNITION_COLLECTION_PREFIX` — optional; defaults to `smf-face`.

The customer matcher calls Amazon Rekognition `SearchFacesByImage` against an event collection. The admin endpoint indexes event preview images with `IndexFaces`, using the Supabase photo UUID as `ExternalImageId` so search results map back to the correct photo.

After setting the AWS environment variables, open `/admin` and use **Build AI face index** to process the event photos. The current button indexes in batches of 25 to avoid one long server request.
