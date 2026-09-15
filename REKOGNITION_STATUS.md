Amazon Rekognition integration has been added server-side.

Required Vercel production variables:
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REKOGNITION_COLLECTION_PREFIX (optional)

After deployment, the admin page should provide a Build AI face index control. Customer matching uses /api/face-match and Amazon Rekognition SearchFacesByImage.
