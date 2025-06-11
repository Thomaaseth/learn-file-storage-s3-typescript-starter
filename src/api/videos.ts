import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import type { BunRequest, S3File } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getVideo, updateVideo } from "../db/videos";
import type { Video } from "../db/videos";
import path from "path";
import { randomBytes } from "crypto";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  const UPLOAD_LIMIT = 1 << 30;
  console.log("uploading video", videoId, "by user", userID);

  const videoData = await getVideo(cfg.db, videoId)
  if (!videoData || videoData.userID !== userID) {
    throw new UserForbiddenError ("Not the owner of the video")
  }
  
  const formData = await req.formData();
  const video = formData.get("video");
  if (!(video instanceof File)) {
    throw new BadRequestError("Video file is missing");
  }

  if (video.size > UPLOAD_LIMIT) {
    throw new BadRequestError("Video is over maximum size in MB");
  }

  const videoType = video.type
  if (videoType !== "video/mp4" && videoType !== "video/mp4") {
    throw new BadRequestError("Incorrect file format")
  }

  const pathRand = randomBytes(32)
  const pathString = pathRand.toString("base64url")
  const fileName = `${pathString}.mp4`
  const destination = path.join(cfg.filepathRoot, fileName)

  const newVideo = await Bun.write(destination, video)
 
  // console.log("File path:", destination)
  const aspectRatio = await getVideoAspectRatio(destination) 
  const processedVideo = await processVideoForFastStart(destination)

  try {
    const s3file: S3File = cfg.s3Client.file(`${aspectRatio}/${fileName}`) 
    const videoToUpload = Bun.file(processedVideo)
    await s3file.write(videoToUpload, {type: "video/mp4"})
    
    const videoUrl = `https://${cfg.s3CfDistribution}/${aspectRatio}/${fileName}`

    videoData.videoURL = videoUrl
    await updateVideo(cfg.db, videoData)

  } finally {
    await Bun.file(destination).delete()
    await Bun.file(processedVideo).delete()
  }

  return respondWithJSON(200, null);
}

export async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", `${filePath}`], {
    stdout: "pipe",
    stderr: "pipe",
  })
  // console.log("Calling ffprobe on:", filePath)

  const textOut = await new Response(proc.stdout).text()
  const textErr = await new Response(proc.stderr).text()
  // console.log("stdout:", textOut)
  // console.log("stderr:", textErr)
  
  const exitCode = await proc.exited
  // console.log("Exit code:", exitCode)

  if (exitCode !== 0) {
    console.log(textErr)
    throw new BadRequestError("Video is not at the correct aspect ratio")
  }
  const jsonParsed = JSON.parse(textOut)
  const width = jsonParsed.streams[0].width;
  const height = jsonParsed.streams[0].height;

  if ((width / height) >= 1.73 && (width / height) <= 1.83) {
    return "landscape"
  } else if ((width / height) >= 0.51 && (width / height) <= 0.61) {
    return "portrait"
  } else {
    return "other"
  }
}

export async function processVideoForFastStart(inputFilePath: string) {
  const newOutputFilePath = `${inputFilePath}.processed`

  const proc = Bun.spawn(["ffmpeg", "-i", `${inputFilePath}`, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", `${newOutputFilePath}`])
  await proc.exited
  return newOutputFilePath
}

// export async function generatePresignedURL(cfg: ApiConfig, key: string, expireTime: number) {
//     console.log("About to presign with key:", key);

//   return await cfg.s3Client.presign(key, {
//     expiresIn: expireTime,
//     method: "GET",
//     type: "video/mp4",
//   })
// }

//   export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
//     if (!video.videoURL) {
//       return video;
//     }
//     console.log("Key being passed to generatePresignedURL:", video.videoURL);

//     video.videoURL = await generatePresignedURL(cfg, video.videoURL, 5 * 60);
  
//     return video;
//   }


// export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
//   const key = video.videoURL

//   if (!key) {
//     throw new BadRequestError("No video found")
//   }
//   console.log("Key being passed to generatePresignedURL:", key);
//   const presignedUrl  = await generatePresignedURL(cfg, key, 3600)
//   video.videoURL = presignedUrl;
//   return video
// }
