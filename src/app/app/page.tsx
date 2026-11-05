import { redirect } from 'next/navigation'; import { getCurrentUser } from '@/lib/auth'; import Dashboard from '@/components/Dashboard';
export default async function AppPage(){const user=await getCurrentUser();if(!user)redirect('/login');return <Dashboard user={user}/>;}
