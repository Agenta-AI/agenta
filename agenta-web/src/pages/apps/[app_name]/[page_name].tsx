import { useRouter } from 'next/router';
import Datasets from "@/pages/datasets";
import Playground from '@/pages/playground';
import Evaluation from '@/pages/evaluations';
import Results from '@/pages/results';

export default function Item() {
  const router = useRouter();
  const { app_name } = router.query;
  const { page_name } = router.query;

    if (page_name == "datasets") {
      return <Datasets/>
    }
    else if (page_name == "playground") {
      return <Playground/>
    }
    else if (page_name == "evaluations") {
      return <Evaluation/>
    }
    else if (page_name == "results") {
      return <Results/>
    }
    else {
      <div>loading route</div>
    }
}
