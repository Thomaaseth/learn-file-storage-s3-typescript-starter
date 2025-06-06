import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { arrayBuffer } from "stream/consumers";
import path from "path";




export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here
  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file is missing");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail is over maximum size in MB");
  }

  const mediaType = file.type;
  const imageData = await file.arrayBuffer()

  const fileName = `${videoId}.${mediaType}`
  const destination = path.join(cfg.assetsRoot, fileName)

  const newFile = await Bun.write(destination, imageData)

  const videoData = await getVideo(cfg.db, videoId)
  if (!videoData || videoData.userID !== userID) {
    throw new UserForbiddenError ("Not the owner of the video")
  }
  const fileUrl = `http://localhost:${cfg.port}/assets/${fileName}`
  // videoData.thumbnailURL = fileUrl
  await updateVideo(cfg.db, videoData)

  return respondWithJSON(200, videoData);
}
