import initOC from 'opencascade.js';
async function main() {
  const oc = await initOC();
  const trsf = new oc.gp_Trsf_1();
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(trsf)).filter((k: string) => k.startsWith('SetTranslation'));
  console.log('SetTranslation methods:', methods);

  const vec = new oc.gp_Vec_4(1, 2, 3);
  try { trsf.SetTranslation_1(vec); console.log('SetTranslation_1(vec) works'); } catch(e: any) { console.log('SetTranslation_1(vec) fails:', e.message?.substring(0,100)); }

  try {
    const xyz = vec.XYZ();
    trsf.SetTranslation_1(xyz);
    console.log('SetTranslation_1(vec.XYZ()) works');
  } catch(e: any) { console.log('SetTranslation_1(vec.XYZ()) fails:', e.message?.substring(0,100)); }

  const pnt1 = new oc.gp_Pnt_3(0,0,0);
  const pnt2 = new oc.gp_Pnt_3(1,2,3);
  try { trsf.SetTranslation_2(pnt1, pnt2); console.log('SetTranslation_2(p1,p2) works'); } catch(e: any) { console.log('SetTranslation_2(p1,p2) fails:', e.message?.substring(0,100)); }

  trsf.delete();
  vec.delete();
}
main();
