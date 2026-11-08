const { randomUUID } = require('node:crypto')
const campus = require('./campus.json')
const { fail, incomingImage, imageExtension, MAX_IMAGE_BYTES } = require('./security')

function isIncoming(fileID, actorId, prefix) {
  return !!prefix && typeof fileID === 'string' && fileID.startsWith(prefix) && incomingImage(fileID, actorId)
}

async function removeIncoming(cloud, store, actorId, prefix, current) {
  const args = { p_actor_id: actorId, p_storage_prefix: prefix }
  let retries = []
  try {
    const due = await store.rpc('claim_incoming', { ...args, p_file_id: null })
    if (Array.isArray(due)) retries = due
  }
  catch { console.error('market pg incoming retry claim failed') }
  const owned = [current, ...retries].filter(job => job && isIncoming(job.fileID, actorId, prefix))
  const jobs = [...new Map(owned.map(job => [job.fileID, job])).values()]
  let removed = new Set()
  try {
    const result = await cloud.deleteFile({ fileList: jobs.map(job => job.fileID) })
    removed = new Set((result?.fileList || []).filter(item => item.status === 0).map(item => item.fileID))
  } catch { /* The lease keeps unacknowledged deletes retryable. */ }
  const results = await Promise.allSettled(jobs.map(job => store.rpc('finish_incoming', {
    p_actor_id: actorId, p_file_id: job.fileID, p_token: job.token, p_deleted: removed.has(job.fileID)
  })))
  if (results.some(result => result.status === 'rejected')) console.error('market pg incoming cleanup acknowledgement failed')
}

async function finalizeImage(cloud, store, event, actorId, prefix) {
  if (!actorId || !isIncoming(event.fileID, actorId, prefix)) fail('INVALID_IMAGE', '上传路径不属于当前用户')
  const job = await store.rpc('claim_incoming', { p_actor_id: actorId, p_storage_prefix: prefix, p_file_id: event.fileID })
  if (job?.fileID !== event.fileID || typeof job.token !== 'string') fail('INVALID_IMAGE', '图片正在处理，请重新上传')
  const avatar = event.purpose === 'avatar'
  let destination
  try {
    const { fileContent } = await cloud.downloadFile({ fileID: event.fileID })
    if (!Buffer.isBuffer(fileContent) || !fileContent.length || fileContent.length > MAX_IMAGE_BYTES) fail('INVALID_IMAGE', '图片不得超过 5 MB')
    const folder = avatar ? 'avatars' : 'images'
    const cloudPath = `${folder}/${actorId}/${randomUUID().replace(/-/g, '')}.${imageExtension(fileContent)}`
    destination = prefix + cloudPath
    const saved = await cloud.uploadFile({ cloudPath, fileContent })
    if (saved.fileID !== destination) fail('INVALID_IMAGE', '云存储返回的图片地址无效')
    return { fileID: saved.fileID }
  } catch (error) {
    if (destination) {
      // A failed response can still leave the destination object in storage.
      try {
        await store.rpc('queue_cleanup', { p_actor_id: actorId, p_school: campus.schoolName, p_storage_prefix: prefix,
          p_kind: avatar ? 'avatar' : 'discarded_upload', p_files: [destination] })
      } catch { console.error('market pg uncertain image upload could not be queued') }
    }
    throw error
  } finally {
    // The pending lease survives a timeout or a database error after the external call.
    await removeIncoming(cloud, store, actorId, prefix, job)
  }
}

module.exports = { finalizeImage }
