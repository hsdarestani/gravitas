# name: graviquest-local-object-storage
# about: Configure the AWS SDK's supported path-style option for local S3.
# version: 1.0.0
# authors: GraviQuest
# url: https://github.com/hsdarestani/gravitas
# required_version: 2026.7.0

after_initialize do
  require "aws-sdk-s3"
  Aws.config[:s3] = (Aws.config[:s3] || {}).merge(force_path_style: true)
end
