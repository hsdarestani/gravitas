export const validPhoto = value => typeof value==='string'&&/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(value)&&value.length<160000;
const imageTypes=new Set(['image/jpeg','image/png','image/webp','image/avif','image/gif']);
export async function profilePhoto(file) {
  if (!imageTypes.has(file.type)||file.size>15e6) throw new Error('Choose an image under 15 MB.');
  const bitmap=await createImageBitmap(file);
  try {
    const canvas=document.createElement('canvas');
    const size=240;
    canvas.width=size;
    canvas.height=size;
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle='#102831';
    ctx.fillRect(0,0,size,size);
    const edge=Math.min(bitmap.width,bitmap.height);
    ctx.drawImage(bitmap,(bitmap.width-edge)/2,(bitmap.height-edge)/2,edge,edge,0,0,size,size);
    const value=canvas.toDataURL('image/jpeg',0.82);
    if (!validPhoto(value)) throw new Error('Choose a smaller image.');
    return value;
  } finally {
    bitmap.close();
  }
}
